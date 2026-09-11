import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Device, DeviceClass, DeviceFirmware, FirmwareChannel } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork, logIfItFails } from '../../common/background-work';
import { MODEL } from '../../database/models.module';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { DeviceLogService } from './device-log.service';
import { effectivePendingFirmware, ONLINE_TIMEOUT, pendingFirmwareMatches, pendingFirmwareNotEquals } from './device.queries';

const UPGRADE_TIMEOUT: number = 10 * 60 * 1000;
const UPGRADE_INSTRUCTION_INITIAL_DELAY: number = 30 * 1000;
const UPGRADE_INSTRUCTION_MAX_DELAY: number = 24 * 60 * 60 * 1000;

/**
 * Handing the fleet its firmware: which devices are told to upgrade next, when
 * a device that has been told but has not moved is told again, and what the
 * fleet is running while it happens.
 */
@Injectable()
export class DeviceFirmwareRolloutService implements OnModuleInit, OnApplicationShutdown {
  private readonly upgradeInstructionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly upgradeInstructionBackoff = new Map<string, { firmwareId: string; nextDelayMs: number }>();
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceClass) private readonly deviceClasses: Model<DeviceClass & Document>,
    @InjectModel(MODEL.deviceFirmware) private readonly firmwares: Model<DeviceFirmware & Document>,
    private readonly mqtt: MqttClientService,
    private readonly logs: DeviceLogService,
  ) {}

  public onModuleInit(): void {
    this.work.repeat('The firmware rollout', () => this.findUpgradeableDevices(), 10000);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
    for (const timer of this.upgradeInstructionTimers.values()) clearTimeout(timer);
    this.upgradeInstructionTimers.clear();
  }

  private resetUpgradeInstructionBackoff(deviceId: string) {
    const timer = this.upgradeInstructionTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.upgradeInstructionTimers.delete(deviceId);
    }
    this.upgradeInstructionBackoff.delete(deviceId);
  }

  /** Notes that the device is alive, and arranges for it to hear about a pending upgrade. */
  public async checkAndUpgrade(device: Device) {
    await this.devices.findOneAndUpdate({ device_id: device.device_id }, { lastseen: Date.now() });

    const pendingFirmware = effectivePendingFirmware(device);
    const needsUpgrade = device.current_firmware != pendingFirmware && !!pendingFirmware;
    if (!needsUpgrade) {
      this.resetUpgradeInstructionBackoff(device.device_id);
      return;
    }

    // One timer per device, and none at all once the server is stopping.
    if (this.upgradeInstructionTimers.has(device.device_id) || this.work.isStopped) {
      return;
    }

    let backoff = this.upgradeInstructionBackoff.get(device.device_id);
    if (!backoff || backoff.firmwareId !== pendingFirmware) {
      backoff = { firmwareId: pendingFirmware, nextDelayMs: UPGRADE_INSTRUCTION_INITIAL_DELAY };
      this.upgradeInstructionBackoff.set(device.device_id, backoff);
    }

    const timer = setTimeout(() => {
      logIfItFails(`The upgrade instruction for device ${device.device_id}`, this.sendUpgradeInstruction(device.device_id));
    }, backoff.nextDelayMs);
    this.upgradeInstructionTimers.set(device.device_id, timer);
  }

  private async sendUpgradeInstruction(deviceId: string) {
    try {
      const device = await this.devices.findOne({ device_id: deviceId });
      const pendingFirmware = device ? effectivePendingFirmware(device) : '';
      if (!device || device.current_firmware == pendingFirmware || !pendingFirmware) {
        this.upgradeInstructionBackoff.delete(deviceId);
        return;
      }

      logger.info(
        `Sending instruction to upgrade device ${device.device_id} to firmware ${pendingFirmware} from firmware ${device.current_firmware}`,
      );
      this.mqtt.publish('/devices/' + device.device_id + '/firmware', pendingFirmware);

      const existing = this.upgradeInstructionBackoff.get(deviceId);
      const baseDelay = existing?.firmwareId === pendingFirmware ? existing.nextDelayMs : UPGRADE_INSTRUCTION_INITIAL_DELAY;
      this.upgradeInstructionBackoff.set(deviceId, {
        firmwareId: pendingFirmware,
        nextDelayMs: Math.min(baseDelay * 2, UPGRADE_INSTRUCTION_MAX_DELAY),
      });
    } catch (error) {
      logger.error(`Failed sending the upgrade instruction to device ${deviceId}: ${error}`);
    } finally {
      this.upgradeInstructionTimers.delete(deviceId);
    }
  }

  /**
   * What a device reports running. An id that matches what it was told to
   * install ends the update and goes into the diary; anything else is only
   * recorded, as it is what the device came back with on its own.
   */
  public async onFirmwareReported(device: Device, reportedFirmwareId: string): Promise<void> {
    if (reportedFirmwareId == device.current_firmware) {
      return;
    }

    if (reportedFirmwareId != effectivePendingFirmware(device)) {
      await this.devices.findByIdAndUpdate(device._id, { current_firmware: reportedFirmwareId });
      return;
    }

    const previousFirmwareId = device.current_firmware || 'unknown';
    const [previousFw, newFw] = await Promise.all([
      previousFirmwareId !== 'unknown' ? this.firmwares.findOne({ firmware_id: previousFirmwareId }, { version: 1 }) : null,
      this.firmwares.findOne({ firmware_id: reportedFirmwareId }, { version: 1 }),
    ]);
    const previousFirmwareLabel = previousFw?.version || previousFirmwareId;
    const newFirmwareLabel = newFw?.version || reportedFirmwareId;
    await this.devices.findByIdAndUpdate(device._id, { current_firmware: reportedFirmwareId, fwupdate_end: Date.now() });
    logger.info('device ' + device.device_id + ' finished firmware update, time: ' + (Date.now() - device.fwupdate_start) / 1000 + 's');
    await this.logs.logMessage(device.device_id, {
      title: 'message-firmware-update-complete-with-ids',
      message: `message-firmware-update-complete-with-ids:${previousFirmwareLabel} -> ${newFirmwareLabel}`,
      severity: 0,
      categories: ['device', 'device-firmware'],
    });
  }

  private async findUpgradeableDevices() {
    const classes = await this.deviceClasses.find();
    for (const device_class of classes) {
      // As in the loops above: a pass awaits its way through every class, so it
      // can outlive the server unless it looks.
      if (this.work.isStopped) break;

      await this.findUpgradeableDevicesByClass(device_class, device_class.firmware_id, this.firmwareChannelQuery('stable'));
      if (device_class.beta_firmware_id) {
        await this.findUpgradeableDevicesByClass(device_class, device_class.beta_firmware_id, this.firmwareChannelQuery('beta'));
      }
      if (device_class.alpha_firmware_id) {
        await this.findUpgradeableDevicesByClass(device_class, device_class.alpha_firmware_id, this.firmwareChannelQuery('alpha'));
      }
    }
  }

  /**
   * Which devices a channel covers. `firmwareChannel` says it outright; a
   * device that predates the setting is read from the auto-update flag it was
   * configured with instead.
   */
  private firmwareChannelQuery(channel: FirmwareChannel): object {
    const legacyAutoUpdateOptedIn = {
      $or: [{ 'cloudSettings.autoFirmwareUpdate': true }, { 'firmwareSettings.autoUpdate': true }],
    };

    if (channel === 'stable') {
      return {
        $or: [
          { 'cloudSettings.firmwareChannel': 'stable' },
          {
            'cloudSettings.firmwareChannel': { $exists: false },
            'cloudSettings.betaFeatures': { $ne: true },
            ...legacyAutoUpdateOptedIn,
          },
        ],
      };
    }

    if (channel === 'beta') {
      return {
        $or: [
          { 'cloudSettings.firmwareChannel': 'beta' },
          {
            'cloudSettings.firmwareChannel': { $exists: false },
            'cloudSettings.betaFeatures': true,
            ...legacyAutoUpdateOptedIn,
          },
        ],
      };
    }

    return { 'cloudSettings.firmwareChannel': channel };
  }

  private async findUpgradeableDevicesByClass(
    device_class: Omit<DeviceClass, 'firmware_id' | 'beta_firmware_id' | 'alpha_firmware_id'>,
    firmwareId: string,
    additionalQueryConditions?: object,
  ) {
    const currently_upgrading = await this.devices
      .where({
        class_id: device_class.class_id,
        current_firmware: { $ne: firmwareId },
        fwupdate_start: { $gte: Date.now() - UPGRADE_TIMEOUT },
        $and: [pendingFirmwareMatches(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
      })
      .countDocuments();

    const failed = await this.devices
      .where({
        class_id: device_class.class_id,
        current_firmware: { $ne: firmwareId },
        fwupdate_start: { $lte: Date.now() - UPGRADE_TIMEOUT },
        $and: [pendingFirmwareMatches(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
      })
      .countDocuments();

    if (currently_upgrading < device_class.concurrent && failed < device_class.maxfails) {
      const devices: Device[] = await this.devices
        .find({
          lastseen: { $gte: Date.now() - ONLINE_TIMEOUT },
          class_id: device_class.class_id,
          $and: [pendingFirmwareNotEquals(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
        })
        .limit(device_class.concurrent - currently_upgrading);

      for (const device of devices) {
        logger.info('upgrading device ' + device.device_id + ' to firmware ' + firmwareId);
        await this.devices.findByIdAndUpdate(device._id, {
          $set: {
            'cloudSettings.pendingFirmware': firmwareId,
            fwupdate_start: Date.now(),
          },
          $unset: { pending_firmware: '' },
        });
        this.resetUpgradeInstructionBackoff(device.device_id);
      }
    }
  }

  public async getFirmwareVersions(): Promise<any> {
    const classes: DeviceClass[] = await this.deviceClasses.find({});

    const upgradetimes = await this.devices.aggregate([
      {
        $match: {
          fwupdate_end: { $type: 'number' },
        },
      },
      {
        $group: {
          _id: '$current_firmware',
          avgTime: { $avg: { $subtract: ['$fwupdate_end', '$fwupdate_start'] } },
          maxTime: { $max: { $subtract: ['$fwupdate_end', '$fwupdate_start'] } },
        },
      },
    ]);

    const class_count = await Promise.all(
      classes.map(async deviceclass => {
        const fwversions: DeviceFirmware[] = await this.firmwares.find({ class_id: deviceclass.class_id });
        const fwids = fwversions.map(fw => fw.firmware_id);

        const versions = await Promise.all(
          fwversions.map(async fwversion => {
            const upgrade_time = upgradetimes.find(el => el._id == fwversion.firmware_id);
            return {
              fw: fwversion,
              online: await this.devices
                .where({
                  lastseen: { $gte: Date.now() - ONLINE_TIMEOUT },
                  class_id: deviceclass.class_id,
                  current_firmware: fwversion.firmware_id,
                })
                .countDocuments(),
              total: await this.devices
                .where({
                  current_firmware: fwversion.firmware_id,
                  class_id: deviceclass.class_id,
                })
                .countDocuments(),
              updating: await this.devices
                .where({
                  fwupdate_start: { $gte: Date.now() - UPGRADE_TIMEOUT },
                  current_firmware: { $ne: fwversion.firmware_id },
                  class_id: deviceclass.class_id,
                  ...pendingFirmwareMatches(fwversion.firmware_id),
                })
                .countDocuments(),
              failed: await this.devices
                .where({
                  fwupdate_start: { $lte: Date.now() - UPGRADE_TIMEOUT },
                  current_firmware: { $ne: fwversion.firmware_id },
                  class_id: deviceclass.class_id,
                  ...pendingFirmwareMatches(fwversion.firmware_id),
                })
                .countDocuments(),
              avgtime: upgrade_time?.avgTime || 0,
              maxtime: upgrade_time?.maxTime || 0,
            };
          }),
        );

        versions.push({
          fw: {
            firmware_id: null,
            name: 'unknown',
            version: '0',
            class_id: deviceclass.class_id,
          },
          online: await this.devices
            .where({ lastseen: { $gte: Date.now() - ONLINE_TIMEOUT }, class_id: deviceclass.class_id, current_firmware: { $nin: fwids } })
            .countDocuments(),
          total: await this.devices.where({ current_firmware: { $not: { $in: fwids } }, class_id: deviceclass.class_id }).countDocuments(),
          updating: 0,
          failed: 0,
          avgtime: 0,
          maxtime: 0,
        });

        return {
          class: deviceclass,
          versions: versions,
        };
      }),
    );

    return class_count;
  }
}
