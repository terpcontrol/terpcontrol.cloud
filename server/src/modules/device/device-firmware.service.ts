import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Device, DeviceClass, DeviceFirmware, DeviceFirmwareBinary, FirmwareChannel, FirmwareListEntry, UserFirmwareList } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { BackgroundWork } from '../../common/background-work';
import { MODEL } from '../../database/models.module';
import { deviceAccessFilter, effectivePendingFirmware } from './device.queries';

const MAX_OTA_FIRMWARE_BINARY_BYTES = 2 * 1024 * 1024;

/** The firmware records and their binaries: what exists, and what a device may be offered. */
@Injectable()
export class DeviceFirmwareService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceClass) private readonly deviceClasses: Model<DeviceClass & Document>,
    @InjectModel(MODEL.deviceFirmware) private readonly firmwares: Model<DeviceFirmware & Document>,
    @InjectModel(MODEL.deviceFirmwareBinary) private readonly firmwareBinaries: Model<DeviceFirmwareBinary & Document>,
  ) {}

  public onModuleInit(): void {
    this.work.run('Backfilling the firmware timestamps', () => this.backfillFirmwareCreatedAt());
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  /**
   * Records written before either field existed: `createdAt` orders the list a
   * device is offered, and `wasStable` keeps a build that once shipped in it.
   */
  private async backfillFirmwareCreatedAt() {
    try {
      const missing = await this.firmwares.find({ createdAt: { $exists: false } }, { _id: 1 });
      for (const doc of missing) {
        const created = (doc._id as any).getTimestamp?.()?.getTime?.();
        if (typeof created === 'number') {
          await this.firmwares.updateOne({ _id: doc._id }, { $set: { createdAt: created } });
        }
      }
      if (missing.length > 0) {
        logger.info(`Backfilled createdAt for ${missing.length} firmware records`);
      }

      const classes = await this.deviceClasses.find({}, { firmware_id: 1 });
      const stableIds = classes.map(c => c.firmware_id).filter((id): id is string => !!id);
      if (stableIds.length > 0) {
        const result = await this.firmwares.updateMany({ firmware_id: { $in: stableIds }, wasStable: { $ne: true } }, { $set: { wasStable: true } });
        if (result.modifiedCount > 0) {
          logger.info(`Marked ${result.modifiedCount} firmware records as wasStable`);
        }
      }
    } catch (e) {
      logger.error(`Failed to backfill firmware createdAt: ${e}`);
    }
  }

  public async createFirmware(classname: string, version: string): Promise<DeviceFirmware> {
    const deviceclass = await this.deviceClasses.findOne({ name: classname });
    if (!deviceclass) {
      throw new HttpException(404, 'Class not found');
    }

    return await this.firmwares.create({
      firmware_id: uuidv4(),
      class_id: deviceclass.class_id,
      name: classname,
      version: version,
      createdAt: Date.now(),
    });
  }

  public async deleteFirmware(firmware_id: string): Promise<void> {
    await this.firmwareBinaries.deleteMany({ firmware_id: firmware_id });
    await this.firmwares.deleteOne({ firmware_id: firmware_id });
  }

  public async updateFirmwareVersion(firmware_id: string, version: string): Promise<DeviceFirmware> {
    const original = await this.firmwares.findOne({ firmware_id: firmware_id });
    if (!original) {
      throw new HttpException(404, 'Firmware not found');
    }
    // Update the firmware being edited.
    const updated = await this.firmwares.findOneAndUpdate({ firmware_id: firmware_id }, { version: version }, { new: true });
    // For each other class: propagate the new label only when the old label
    // appears exactly once within that class (unambiguous 1-to-1 match).
    const matches = await this.firmwares.find({ version: original.version, class_id: { $ne: original.class_id } });
    const byClass = new Map<string, (typeof matches)[number][]>();
    for (const m of matches) {
      const list = byClass.get(m.class_id) ?? [];
      list.push(m);
      byClass.set(m.class_id, list);
    }
    for (const firmwares of byClass.values()) {
      if (firmwares.length === 1) {
        await this.firmwares.updateOne({ firmware_id: firmwares[0].firmware_id }, { version: version });
      }
    }
    return updated;
  }

  public async listFirmwaresForDevice(device_id: string, user_id: string, is_demo = false): Promise<UserFirmwareList> {
    const device = await this.devices.findOne(deviceAccessFilter(device_id, user_id, false, is_demo), {
      class_id: 1,
      current_firmware: 1,
      'cloudSettings.pendingFirmware': 1,
      pending_firmware: 1,
    });
    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    const [device_class, firmwares] = await Promise.all([
      this.deviceClasses.findOne({ class_id: device.class_id }),
      this.firmwares.find({ class_id: device.class_id }, { _id: 0, firmware_id: 1, version: 1, createdAt: 1, wasStable: 1 }).sort({ createdAt: -1 }),
    ]);

    const stableCutoff = firmwares.filter(fw => fw.wasStable).reduce((max, fw) => Math.max(max, fw.createdAt ?? 0), -Infinity);
    const pinnedIds = new Set([device.current_firmware, effectivePendingFirmware(device)].filter(Boolean));
    const visible = firmwares.filter(fw => fw.wasStable || (fw.createdAt ?? 0) > stableCutoff || pinnedIds.has(fw.firmware_id));

    const channelByFirmwareId = new Map<string, FirmwareChannel[]>();
    if (device_class?.firmware_id) {
      channelByFirmwareId.set(device_class.firmware_id, ['stable']);
    }
    if (device_class?.beta_firmware_id) {
      const list = channelByFirmwareId.get(device_class.beta_firmware_id) ?? [];
      list.push('beta');
      channelByFirmwareId.set(device_class.beta_firmware_id, list);
    }
    if (device_class?.alpha_firmware_id) {
      const list = channelByFirmwareId.get(device_class.alpha_firmware_id) ?? [];
      list.push('alpha');
      channelByFirmwareId.set(device_class.alpha_firmware_id, list);
    }

    return {
      current_firmware: device.current_firmware ?? '',
      firmwares: visible.map(fw => ({
        firmware_id: fw.firmware_id,
        version: fw.version,
        createdAt: fw.createdAt,
        channels: channelByFirmwareId.get(fw.firmware_id) ?? [],
        current: fw.firmware_id === device.current_firmware,
      })),
    };
  }

  public async createFirmwareBinary(fw_id: string, name: string, data: Buffer): Promise<DeviceFirmwareBinary> {
    if (name === 'firmware.bin' && data.length > MAX_OTA_FIRMWARE_BINARY_BYTES) {
      throw new HttpException(
        413,
        `Firmware binary is ${data.length} bytes, exceeding the ${MAX_OTA_FIRMWARE_BINARY_BYTES} byte OTA partition limit`,
      );
    }

    const binary = await this.firmwareBinaries.findOneAndUpdate(
      { firmware_id: fw_id, name: name },
      {
        firmware_id: fw_id,
        name: name,
        data: data,
      },
      { new: true, upsert: true },
    );

    if (!binary) {
      throw new HttpException(500, 'Could not store firmware binary');
    }

    return binary;
  }

  public async findFirmwareByNameVersion(name: string, version: string): Promise<DeviceFirmware> {
    const firmware: DeviceFirmware = await this.firmwares.findOne(
      {
        name: name,
        version: version,
      },
      { _id: 0, firmware_id: 1, name: 1, version: 1 },
    );
    return firmware;
  }

  public async findAllFirmware(): Promise<FirmwareListEntry[]> {
    return this.firmwares.find({}, { _id: 0, firmware_id: 1, name: 1, version: 1 }).lean<FirmwareListEntry[]>();
  }

  public async getFirmwareBinary(firmware_id: string, binary_name: string): Promise<Buffer> {
    const binary = await this.firmwareBinaries.findOne({ firmware_id: firmware_id, name: binary_name }, { data: 1 });

    // A device asking for a build that was deleted, or for a name that was
    // never uploaded, hears that rather than reading a 500 as a failed update.
    if (!binary) {
      throw new HttpException(404, 'Firmware binary not found');
    }

    return binary.data;
  }
}
