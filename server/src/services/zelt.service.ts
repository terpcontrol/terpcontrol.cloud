import { v4 as uuidv4 } from 'uuid';
import { Device, Ding, GeraetBindung, Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { withMigrationLock } from '@utils/migration-lock';
import { logger } from '@utils/logger';

const ZELT_BACKFILL = 'zelt-aus-geraet';
const FALLBACK_ZEITZONE = 'Europe/Berlin';

// Day boundaries need a zone and the migration has nobody to ask: the
// deployment's own zone, and where that is unset the one the product is written for.
const serverZeitzone = (): string => process.env.TZ || FALLBACK_ZEITZONE;

/** Everything a tent needs to know about the device it is being made for. */
type Geraet = Pick<Device, 'device_id' | 'owner_id' | 'name' | 'claimed_at'>;

const istOffen = (bindung: GeraetBindung): boolean => bindung.bis === undefined || bindung.bis === null;

class ZeltService {
  public async zelteOfUser(besitzer_id: string): Promise<Zelt[]> {
    return zeltModel.find({ besitzer_id: besitzer_id }, { _id: 0, __v: 0 }).lean();
  }

  public async zeltOfUser(zelt_id: string, besitzer_id: string): Promise<Zelt | null> {
    return zeltModel.findOne({ zelt_id: zelt_id, besitzer_id: besitzer_id }, { _id: 0, __v: 0 }).lean();
  }

  /**
   * Gives every claimed device a tent of its own. Runs once per deployment and
   * never per request. A device whose owner already has a tent for it is
   * skipped, and the unique binding key rejects a second writer, so neither a
   * repeated run nor two instances can produce a twin.
   *
   * Only devices claimed before `claimed_at` existed need it: from there on a
   * claim writes its own binding (§14.2), which is also why this cannot be the
   * only thing that ever creates a tent.
   */
  public async backfillZelte(): Promise<number> {
    let created = 0;

    await withMigrationLock(ZELT_BACKFILL, async () => {
      // The unique binding key only guards once its index exists, and index
      // builds do not block startup — so wait for it rather than race it.
      await zeltModel.createIndexes();

      const devices: Geraet[] = await deviceModel
        .find({ owner_id: { $nin: [null, ''] } }, { device_id: 1, owner_id: 1, name: 1, claimed_at: 1 })
        .lean();
      // One query for the whole fleet rather than a full-history query per
      // device, and a store that cannot answer aborts the run before the first
      // write instead of dating half the fleet from today.
      const ersteMessung = await dataService.getFirstSampleTimes();

      for (const device of devices) {
        if (await zeltModel.exists({ besitzer_id: device.owner_id, 'geraete.geraet_id': device.device_id })) {
          continue;
        }
        const bindung = { geraet_id: device.device_id, seit: this.beginn(device, ersteMessung.get(device.device_id)) };
        if (await this.createZelt(device.owner_id, device.name ?? '', bindung, `${device.owner_id}:${device.device_id}`)) {
          created++;
        }
      }

      if (created > 0) {
        logger.info(`Created ${created} tents for already claimed devices`);
      }
    });

    return created;
  }

  /**
   * §3.1: the claim if one was recorded, else the oldest measurement, else
   * today.
   *
   * Nothing wider. `DeviceLog` and `Image` rows also date a device, and reading
   * them would date a device that was never online or whose owner only ever
   * wrote and photographed — but those are precisely the rows that survive a
   * sale, because neither claim nor unclaim deletes anything, so a second-hand
   * controller would carry a stranger's year into this tent and §14.3 would
   * then project all of it. Where this dates a tent too late nothing is lost:
   * the rows stay, the reads are clipped, and §3.6 lets the owner move
   * `tag_null` by hand. Where it dated one too early, a stranger's diary would
   * be in it and no edit could take it back out.
   */
  private beginn(geraet: Geraet, ersteMessung: number | undefined): number {
    return geraet.claimed_at ?? ersteMessung ?? Date.now();
  }

  /**
   * §14.2 step 2 — the write that makes a claimed device visible. Without it
   * the device is claimed into no tent at all and everything it reports from
   * then on is invisible, however alive the account looks.
   *
   * `seit` is the claim moment and never earlier: §14.3 reads device-keyed rows
   * from `seit` forward, so this is the whole of what keeps a second-hand
   * controller's past out of the new owner's diary.
   */
  public async bindungBeginnen(geraet_id: string, besitzer_id: string, geraet_name = '', zelt_id?: string): Promise<Zelt | null> {
    const seit = Date.now();
    const zelte = await this.zelteOfUser(besitzer_id);
    // §14.1: into the tent the claim named, and where it named none the same
    // rule `/list` applies — exactly one tent goes straight through. With
    // several, which grow the hardware joined is a question only the owner can
    // answer, so the device gets a tent of its own and stays movable rather
    // than being guessed into a grow it may have nothing to do with.
    const ziel = zelt_id ? zelte.find(zelt => zelt.zelt_id === zelt_id) : zelte.length === 1 ? zelte[0] : undefined;

    if (ziel?.geraete.some(bindung => bindung.geraet_id === geraet_id && istOffen(bindung))) {
      return ziel;
    }

    // A claim transfers a device without an unclaim ever happening, and a
    // device that changed hands must stop pointing at the seller's tent.
    await this.bindungBeenden(geraet_id);

    const bindung: GeraetBindung = { geraet_id: geraet_id, seit: seit };
    if (!ziel) {
      return this.createZelt(besitzer_id, geraet_name, bindung);
    }

    // §14.9: appended, never reopened. The earlier binding keeps its `bis`, so
    // each stretch of ownership stays inside its own window.
    await zeltModel.updateOne({ zelt_id: ziel.zelt_id, besitzer_id: besitzer_id }, { $push: { geraete: bindung } });
    return { ...ziel, geraete: [...ziel.geraete, bindung] };
  }

  /** Null when another instance created the same tent first. */
  private async createZelt(besitzer_id: string, name: string, bindung: GeraetBindung, migriert_aus?: string): Promise<Zelt | null> {
    const zelt: Zelt = {
      zelt_id: uuidv4(),
      besitzer_id: besitzer_id,
      // Naming is the user's; an unnamed device leaves it empty rather than
      // writing a word in a language the server cannot know.
      name: name?.trim() || '',
      geraete: [bindung],
      zeitzone: serverZeitzone(),
      // Day 1 of this grow, and only an explicit edit may ever move it (§3.6).
      tag_null: bindung.seit,
      erstellt_at: Date.now(),
      // Only a migrated tent carries it: the unique key is what stops two
      // instances deriving a tent for the same device, and a claim must stay
      // repeatable — the same device claimed, removed and claimed again would
      // collide with its own first tent.
      ...(migriert_aus ? { migriert_aus: migriert_aus } : {}),
    };

    try {
      await zeltModel.create(zelt);
    } catch (error: any) {
      if (error?.code === 11000) {
        return null;
      }
      throw error;
    }

    await this.laufEins(zelt);
    return zelt;
  }

  /**
   * §3.2: the day counter reads the open run, and the create sheet mints run 1
   * at `t = tag_null`. A tent made anywhere else needs it too, or `Durchgang
   * beenden` would open run 2 in a tent that never had a run 1 and the number
   * printed on every Tafel would depend on where the tent came from.
   */
  private async laufEins(zelt: Zelt): Promise<void> {
    const lauf: Ding = {
      ding_id: uuidv4(),
      zelt_id: zelt.zelt_id,
      art: 'lauf',
      // Runs are numbered, not named; the app writes `Lauf 1` in its own language.
      name: '',
      t: zelt.tag_null,
      // Explicit null: the open run, as against a run that is not an interval.
      t_ende: null,
      d: { nummer: 1 },
    };

    try {
      await dingModel.create(lauf);
    } catch (error) {
      // The tent is already written, and a tent without a run still counts its
      // days from `tag_null`. Failing the claim over this would leave the
      // device with no tent at all, which is the worse of the two.
      logger.error(`Zelt ${zelt.zelt_id} was created without its first Lauf: ${error}`);
    }
  }

  /**
   * Ends a device's open binding. A device that leaves its owner must stop
   * pointing at their tent, or its next owner's readings arrive in a stranger's diary.
   */
  public async bindungBeenden(geraet_id: string): Promise<void> {
    await zeltModel.updateMany(
      { geraete: { $elemMatch: { geraet_id: geraet_id, bis: { $exists: false } } } },
      { $set: { 'geraete.$[binding].bis': Date.now() } },
      { arrayFilters: [{ 'binding.geraet_id': geraet_id, 'binding.bis': { $exists: false } }] },
    );
  }
}

export const zeltService = new ZeltService();
