import { v4 as uuidv4 } from 'uuid';
import { Device, Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { withMigrationLock } from '@utils/migration-lock';
import { aeltesteSpuren, fruehesteZeit } from '@utils/spur';
import { logger } from '@utils/logger';

const ZELT_BACKFILL = 'zelt-aus-geraet';
const FALLBACK_ZEITZONE = 'Europe/Berlin';

// Day boundaries need a zone and the migration has nobody to ask: the
// deployment's own zone, and where that is unset the one the product is written for.
const serverZeitzone = (): string => process.env.TZ || FALLBACK_ZEITZONE;

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
   */
  public async backfillZelte(): Promise<number> {
    let created = 0;

    await withMigrationLock(ZELT_BACKFILL, async () => {
      // The unique binding key only guards once its index exists, and index
      // builds do not block startup — so wait for it rather than race it.
      await zeltModel.createIndexes();

      const devices: Device[] = await deviceModel.find({ owner_id: { $nin: [null, ''] } }, { device_id: 1, owner_id: 1, name: 1 }).lean();
      // One query per store for the whole fleet rather than a full-history scan
      // per device, and a store that cannot answer aborts the run before the
      // first write instead of dating half the fleet from today.
      const geraete = devices.map(device => device.device_id);
      const [ersteMessung, ersteSpur] = await Promise.all([dataService.getFirstSampleTimes(), aeltesteSpuren(geraete)]);

      for (const device of devices) {
        if (await zeltModel.exists({ besitzer_id: device.owner_id, 'geraete.geraet_id': device.device_id })) {
          continue;
        }
        if (await this.createZelt(device, fruehesteZeit(ersteMessung.get(device.device_id), ersteSpur.get(device.device_id)))) {
          created++;
        }
      }

      if (created > 0) {
        logger.info(`Created ${created} tents for already claimed devices`);
      }
    });

    return created;
  }

  /** False when another instance created the same tent first. */
  private async createZelt(device: Device, ersteSpur: number | undefined): Promise<boolean> {
    // The device has no claim timestamp, so the oldest trace it left anywhere -
    // a measurement, a log line, a photograph - is the closest evidence of when
    // its grow began. Reading that from measurements alone dated a device with
    // none from today and hid its whole past behind `seit` (§14.3): a device
    // that was never online, one offline for longer than the retention window
    // and one whose owner only ever wrote and photographed all have a history
    // and no samples. Only a device with no trace at all starts today.
    const seit = ersteSpur ?? Date.now();

    const zelt: Zelt = {
      zelt_id: uuidv4(),
      besitzer_id: device.owner_id,
      // Naming is the user's; an unnamed device leaves it empty rather than
      // writing a word in a language the migration cannot know.
      name: device.name?.trim() || '',
      geraete: [{ geraet_id: device.device_id, seit: seit }],
      zeitzone: serverZeitzone(),
      // Day 1 of an existing grow, and only an explicit edit may ever move it.
      tag_null: seit,
      erstellt_at: Date.now(),
      migriert_aus: `${device.owner_id}:${device.device_id}`,
    };

    try {
      await zeltModel.create(zelt);
      return true;
    } catch (error: any) {
      if (error?.code === 11000) {
        return false;
      }
      throw error;
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
