import { v4 as uuidv4 } from 'uuid';
import { Device, Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { withMigrationLock } from '@utils/migration-lock';
import { logger } from '@utils/logger';

const ZELT_BACKFILL = 'zelt-aus-geraet';
const FALLBACK_ZEITZONE = 'Europe/Berlin';
const FALLBACK_NAME = 'Zelt';

const serverZeitzone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_ZEITZONE;

class ZeltService {
  public async zelteOfUser(besitzer_id: string): Promise<Zelt[]> {
    return zeltModel.find({ besitzer_id: besitzer_id }, { _id: 0, __v: 0 }).lean();
  }

  public async zeltOfUser(zelt_id: string, besitzer_id: string): Promise<Zelt | null> {
    return zeltModel.findOne({ zelt_id: zelt_id, besitzer_id: besitzer_id }, { _id: 0, __v: 0 }).lean();
  }

  /**
   * Gives every claimed device a tent of its own. Runs once at boot, never per
   * request, and skips any device that already has one, so a second run and a
   * second instance both write nothing.
   */
  public async backfillZelte(): Promise<number> {
    let created = 0;

    await withMigrationLock(ZELT_BACKFILL, async () => {
      const devices: Device[] = await deviceModel.find({ owner_id: { $nin: [null, ''] } }, { device_id: 1, owner_id: 1, name: 1 }).lean();

      for (const device of devices) {
        if (await zeltModel.exists({ 'geraete.geraet_id': device.device_id })) {
          continue;
        }
        await zeltModel.create(await this.zeltFromDevice(device));
        created++;
      }

      if (created > 0) {
        logger.info(`Created ${created} tents for already claimed devices`);
      }
    });

    return created;
  }

  private async zeltFromDevice(device: Device): Promise<Zelt> {
    const seit = await this.geraetBekanntSeit(device.device_id);

    return {
      zelt_id: uuidv4(),
      besitzer_id: device.owner_id,
      name: device.name?.trim() || FALLBACK_NAME,
      geraete: [{ geraet_id: device.device_id, seit: seit }],
      zeitzone: serverZeitzone(),
      // Day 1 of an existing grow is the day the device started reporting; a
      // later edit is the only thing that may ever move it.
      tag_null: seit,
      erstellt_at: Date.now(),
    };
  }

  /**
   * The device has no claim timestamp, so its oldest measurement is the closest
   * evidence of when its grow began. Without measurements the tent starts today.
   */
  private async geraetBekanntSeit(device_id: string): Promise<number> {
    try {
      return (await dataService.getFirstSampleTime(device_id)) ?? Date.now();
    } catch (error) {
      logger.warn(`No first sample for device ${device_id}: ${error}`);
      return Date.now();
    }
  }
}

export const zeltService = new ZeltService();
