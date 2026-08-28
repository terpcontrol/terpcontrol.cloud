import { v4 as uuidv4 } from 'uuid';
import { Device, Ding, GeraetBindung, Zelt } from '@fg2/shared-types';
import deviceLogModel from '@models/devicelog.model';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import imageModel from '@models/images.model';
import shareModel from '@models/share.model';
import zeltModel from '@models/zelt.model';
import zielStandModel from '@models/zielstand.model';
import { dataService } from '@services/data.service';
import { flacheKonfiguration } from '@utils/konfiguration';
import { withMigrationLock } from '@utils/migration-lock';
import { logger } from '@utils/logger';
import { Vorbefund, vorbefund } from '@utils/vorbefund';

const ZELT_BACKFILL = 'zelt-aus-geraet';
const BINDUNG_NACHWEIS = 'bindung-seit-nachweis';
const FALLBACK_ZEITZONE = 'Europe/Berlin';

/** The log key the webapp translates the `Gerät verbunden` row from (§14.7). */
const VERBUNDEN = 'message-device-connected';

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
   * §14.2 steps 2 to 4 — the write that makes a claimed device visible. Without
   * step 2 the device is claimed into no tent at all and everything it reports
   * from then on is invisible, however alive the account looks.
   *
   * `seit` is the claim moment and never earlier: §14.3 reads device-keyed rows
   * from `seit` forward, so this is the whole of what keeps a second-hand
   * controller's past out of the new owner's diary.
   *
   * Steps 3 and 4 write no diary row and change none: the `erstbefund` targets
   * say what the device's settings were the moment it arrived, and the
   * `Gerät verbunden` log carries the count of what the diary held just before
   * that. Neither can fail the claim - a device in a tent with no first
   * observation is a smaller loss than a device in no tent at all - so both are
   * logged and stepped past, exactly like the tent's first `lauf`.
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

    // §14.6: taken before the write, because a count rendered afterwards proves
    // nothing about what the claim did or did not touch.
    const vorher = await this.schnappschuss(ziel, seit);

    const bindung: GeraetBindung = { geraet_id: geraet_id, seit: seit };
    const zelt = ziel
      ? // §14.9: appended, never reopened. The earlier binding keeps its `bis`,
        // so each stretch of ownership stays inside its own window.
        await zeltModel
          .updateOne({ zelt_id: ziel.zelt_id, besitzer_id: besitzer_id }, { $push: { geraete: bindung } })
          .then(() => ({ ...ziel, geraete: [...ziel.geraete, bindung] }))
      : await this.createZelt(besitzer_id, geraet_name, bindung);

    // Null is the lost race in `createZelt`: another instance wrote the tent and
    // owns the rest of the claim with it.
    if (zelt) {
      await this.erstbefund(zelt, geraet_id, seit);
      await this.geraetVerbunden(zelt, geraet_id, seit, vorher);
      await this.pruefeUnveraendert(zelt, seit, vorher);
    }

    return zelt;
  }

  /**
   * §14.6, the diary as it stood a moment before the device joined it. A tent
   * that does not exist yet held nothing, and says so rather than being left
   * out: the screen prints these numbers either way.
   */
  private async schnappschuss(zelt: Zelt | undefined, seit: number): Promise<Vorbefund> {
    if (!zelt) {
      return vorbefund([], 0, seit, seit);
    }

    const [dinge, fotos] = await Promise.all([
      dingModel.find({ zelt_id: zelt.zelt_id, erfasst_at: { $lt: seit } }, { _id: 0, ding_id: 1, art: 1, d: 1 }).lean() as unknown as Promise<Ding[]>,
      imageModel.countDocuments({ zelt_id: zelt.zelt_id, format: 'user/jpeg', timestamp: { $lt: seit } }),
    ]);

    return vorbefund(dinge, fotos, zelt.tag_null, seit);
  }

  /**
   * §14.2 step 3: one `erstbefund` target per configuration key, in force from
   * the binding's start.
   *
   * This is what makes the chart print `Ziel unbekannt vor 14.09.` instead of
   * drawing today's setpoint back across weeks nobody set it in - §4.3 calls
   * that back-projection the current lie. The rows carry `geraet_id`, so a hand
   * target keeps its own window next to them and the line stays continuous
   * across the claim (§14.5) rather than colliding with it.
   *
   * A device claimed a second time supersedes its own earlier observation and
   * nothing else: only rows this device set are closed, never a hand target,
   * which has no `geraet_id` at all.
   */
  private async erstbefund(zelt: Zelt, geraet_id: string, seit: number): Promise<void> {
    try {
      const geraet = await deviceModel.findOne({ device_id: geraet_id }, { _id: 0, configuration: 1 }).lean();
      const konfiguration = flacheKonfiguration(geraet?.configuration);
      const schluessel = Object.keys(konfiguration);
      if (schluessel.length === 0) {
        return;
      }

      await zielStandModel.updateMany(
        { zelt_id: zelt.zelt_id, geraet_id: geraet_id, gilt_ab: { $lt: seit }, $or: [{ gilt_bis: { $exists: false } }, { gilt_bis: null }] },
        { $set: { gilt_bis: seit } },
      );
      await zielStandModel.insertMany(
        schluessel.map(name => ({
          zelt_id: zelt.zelt_id,
          geraet_id: geraet_id,
          schluessel: name,
          wert: konfiguration[name],
          gilt_ab: seit,
          quelle: 'erstbefund',
        })),
      );
    } catch (error) {
      logger.error(`Zelt ${zelt.zelt_id} got no erstbefund for ${geraet_id}: ${error}`);
    }
  }

  /**
   * §14.2 step 4: the one row the upgrade leaves in the diary, carrying §14.6's
   * count of what was there before it.
   *
   * It is a device log rather than a stored Ding because `ereignis` is projected
   * from that collection - a row written anywhere else would be invisible in the
   * list it exists to appear in.
   */
  private async geraetVerbunden(zelt: Zelt, geraet_id: string, seit: number, vorher: Vorbefund): Promise<void> {
    try {
      await deviceLogModel.create({
        device_id: geraet_id,
        title: VERBUNDEN,
        message: VERBUNDEN,
        severity: 0,
        time: new Date(seit),
        categories: ['device', 'device-connected'],
        data: { zaehler: vorher },
      });
    } catch (error) {
      logger.error(`Zelt ${zelt.zelt_id} records no connection of ${geraet_id}: ${error}`);
    }
  }

  /**
   * §14.6's re-assertion: the same count, taken again after the write.
   *
   * Both reads ask for what was typed before the claim, so nothing the claim
   * itself writes is in either of them and a diary that comes back different is
   * a diary the claim changed - which §14.4 promises cannot happen. The spec
   * aborts the claim on a mismatch; that would need the whole claim to be one
   * transaction, `owner_id` included, so what happens here is the loudest thing
   * short of it. Nothing else in this path writes a stored Ding, so a line in
   * the log is a bug report and not a user's problem.
   */
  private async pruefeUnveraendert(zelt: Zelt, seit: number, vorher: Vorbefund): Promise<void> {
    try {
      const nachher = await this.schnappschuss({ ...zelt, tag_null: vorher.tag_null }, seit);
      if (nachher.hash !== vorher.hash || nachher.dinge !== vorher.dinge) {
        logger.error(`Zelt ${zelt.zelt_id} changed during a claim: ${vorher.dinge} Dinge before, ${nachher.dinge} after`);
      }
    } catch (error) {
      logger.error(`Zelt ${zelt.zelt_id} could not be re-checked after a claim: ${error}`);
    }
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
   * The one-shot repair for tents dated later than their own owner's history.
   *
   * A device claimed before `claimed_at` existed and with no Influx samples
   * left to date it got `seit = the migration moment`, and `seit` is what clips
   * every device-keyed read - so its owner opens a tent whose year of logs and
   * photographs is not in it, and nothing in the UI can widen it: moving
   * `tag_null` (§3.6) moves the day counter, never a binding.
   *
   * Widening it back needs evidence that **this owner** held **this device**
   * earlier, and Mongo carries exactly one such record: a share link is created
   * through `isUserDeviceMiddelware`, so `{owner_id, device_id, createdAt}` is
   * a moment at which the tent's own owner demonstrably had the hardware. No
   * `DeviceLog` or `Image` row can say the same - they carry no owner and they
   * survive a sale, which is the whole reason `seit` was narrowed to §3.1 in
   * the first place, and re-widening over them would put a stranger's diary in
   * somebody's tent.
   *
   * Three bounds keep it honest:
   *  - only devices with no `claimed_at`, which is the population this can
   *    happen to at all; every claim since records its own moment;
   *  - only earlier, never later, and only the earliest binding of that device
   *    in that tent;
   *  - never across somebody else's binding of the same device, because a
   *    device that changed hands has a window this owner has no claim to.
   *
   * `tag_null` is deliberately left where it is. It was invented from the same
   * wrong moment, but moving it would mean moving `lauf` #1 with it, and no
   * migration may rewrite a stored Ding (§14.4). The day counter is the half
   * the owner *can* correct.
   */
  public async repariereBindungen(): Promise<number> {
    let repariert = 0;

    await withMigrationLock(BINDUNG_NACHWEIS, async () => {
      const geraete: Pick<Device, 'device_id' | 'owner_id'>[] = await deviceModel
        .find({ owner_id: { $nin: [null, ''] }, claimed_at: { $exists: false } }, { _id: 0, device_id: 1, owner_id: 1 })
        .lean();

      for (const geraet of geraete) {
        repariert += (await this.repariereGeraet(geraet.device_id, geraet.owner_id)) ? 1 : 0;
      }

      if (repariert > 0) {
        logger.info(`Widened ${repariert} bindings back to what their owner demonstrably had`);
      }
    });

    return repariert;
  }

  /** True when this device's binding was actually moved. */
  private async repariereGeraet(geraet_id: string, besitzer_id: string): Promise<boolean> {
    const nachweis = await this.fruehesterNachweis(geraet_id, besitzer_id);
    if (nachweis === null) {
      return false;
    }

    const zelte: Zelt[] = await zeltModel.find({ 'geraete.geraet_id': geraet_id }, { _id: 0, __v: 0 }).lean();

    let bewegt = false;
    for (const zelt of zelte.filter(zelt => zelt.besitzer_id === besitzer_id)) {
      const index = this.ersteBindung(zelt, geraet_id);
      const bindung = index === -1 ? undefined : zelt.geraete[index];
      if (!bindung || bindung.seit <= nachweis) {
        continue;
      }

      // Another stretch of the device's life sits inside the window this would
      // open. Rows in it are on the same `device_id` and no predicate could
      // tell the two apart afterwards - a previous owner's diary in the worst
      // case, this owner's own second tent in the mildest - so it stays as it is.
      const kollidiert = zelte.some(anderes =>
        (anderes.geraete ?? []).some(
          (andere, wo) =>
            !(anderes.zelt_id === zelt.zelt_id && wo === index) &&
            andere.geraet_id === geraet_id &&
            andere.seit < bindung.seit &&
            (andere.bis === undefined || andere.bis === null || andere.bis > nachweis),
        ),
      );
      if (kollidiert) {
        logger.info(`Zelt ${zelt.zelt_id} keeps its binding of ${geraet_id}: the window is another binding's`);
        continue;
      }

      await zeltModel.updateOne({ zelt_id: zelt.zelt_id }, { $set: { [`geraete.${index}.seit`]: nachweis } });
      bewegt = true;
    }

    return bewegt;
  }

  /** The index of the device's earliest binding in this tent, or -1. */
  private ersteBindung(zelt: Zelt, geraet_id: string): number {
    return (zelt.geraete ?? []).reduce(
      (frueheste, bindung, index) =>
        bindung.geraet_id !== geraet_id ? frueheste : frueheste === -1 || bindung.seit < zelt.geraete[frueheste].seit ? index : frueheste,
      -1,
    );
  }

  /** The earliest moment this owner is on record as having had this device. */
  private async fruehesterNachweis(geraet_id: string, besitzer_id: string): Promise<number | null> {
    // A revoked or expired link is evidence too: it says nothing about who owns
    // the device today, and everything about who owned it the day it was made.
    const share = await shareModel
      .findOne({ device_id: geraet_id, owner_id: besitzer_id, createdAt: { $gt: 0 } }, { _id: 0, createdAt: 1 })
      .sort({ createdAt: 1 })
      .lean();

    return share?.createdAt ?? null;
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
