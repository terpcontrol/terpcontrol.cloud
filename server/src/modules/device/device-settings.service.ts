import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Alarm, ClaimCode, CloudSettings, Device, DeviceAccessInfo, DeviceFirmware, FirmwareChannel, ShareLink } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { demoAlarms, demoCloudSettings } from '@utils/demo';
import { MODEL } from '../../database/models.module';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { DeviceLogService } from './device-log.service';
import { deviceAccessFilter, effectivePendingFirmware } from './device.queries';

const WEBCAM_MODELS = ['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom'];

/**
 * How a device is set up: the configuration the hardware runs, the settings the
 * cloud keeps beside it, and the views of both that a client, a share link or
 * the demo account is allowed to see.
 *
 * It is a module of its own so that the measurement store - which needs the
 * leaf temperature offsets to work out VPD - can read a device's settings
 * without depending on the device module, which drives it in turn.
 */
@Injectable()
export class DeviceSettingsService {
  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceFirmware) private readonly firmwares: Model<DeviceFirmware & Document>,
    @InjectModel(MODEL.claimCode) private readonly claimCodes: Model<ClaimCode & Document>,
    private readonly mqtt: MqttClientService,
    private readonly logs: DeviceLogService,
  ) {}

  /**
   * Who may configure a device is settled before this is called - by the guard
   * on the route, which lets an admin configure one they do not own. Matching
   * the owner here as well only made that case store nothing while still
   * telling the hardware to change, so the device reverted on its next fetch.
   */
  public async configureDevice(device_id: string, config: string): Promise<boolean> {
    // Asked before anything is written: a caller that cannot be served should
    // find nothing changed, rather than a stored configuration it was told had
    // failed and a diary entry that a retry will no longer have a diff for.
    if (!this.mqtt.canPublish) {
      throw new HttpException(503, 'Not connected to the message broker');
    }

    const previous = await this.devices.findOneAndUpdate({ device_id: device_id }, { configuration: config }, { returnOriginal: true });

    if (!previous) {
      throw new HttpException(404, 'Device not found');
    }

    // Not required after the write: the device asks for its configuration when
    // it connects, and is answered from what is stored - so a send that fails
    // between the check above and here costs a delay, not the setting.
    this.mqtt.publish('/devices/' + device_id + '/configuration', config);
    await this.claimCodes.deleteMany({ device_id: device_id });

    const diffStr = this.diffConfigs(previous.configuration, config);
    if (previous.configuration !== config && diffStr.length > 0) {
      await this.logs.logMessage(device_id, {
        title: 'message-device-configuration-updated',
        message: `message-device-configuration-updated:${diffStr}`,
        severity: 0,
        categories: ['device', 'device-configuration'],
        deleted: true,
      });
      return true;
    }

    return false;
  }

  /** Stores what the device reported its configuration to be, without echoing it back. */
  public async storeReportedConfiguration(device_id: string, configuration: unknown): Promise<void> {
    await this.devices.findOneAndUpdate({ device_id: device_id }, { configuration: JSON.stringify(configuration) });
  }

  private diffConfigs(oldConfigJson: string, newConfigJson: string): string {
    try {
      const oldConfig = JSON.parse(oldConfigJson);
      const newConfig = JSON.parse(newConfigJson);

      const diff: Record<string, { old: any; new: any }> = {};
      const readConfigKeys = (obj: any, targetKey: 'old' | 'new', prefix = '') => {
        for (const key in obj) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            readConfigKeys(obj[key], targetKey, fullKey);
          } else {
            if (!(fullKey in diff)) {
              diff[fullKey] = { old: undefined, new: undefined };
            }
            diff[fullKey][targetKey] = obj[key];
          }
        }
      };

      readConfigKeys(oldConfig, 'old');
      readConfigKeys(newConfig, 'new');

      return Object.entries(diff)
        .filter(([_, change]) => change.old !== change.new)
        .filter(([key, _]) => key !== 'daynight.float_start' || diff['daynight.floating']?.new)
        .map(([key, change]) => `    ${key}: ${change.old} -> ${change.new}`)
        .join('\n');
    } catch (e) {
      return 'Could not parse configuration for diff: ' + e.message;
    }
  }

  public async storeDeviceAlarms(device_id: string, alarms: Alarm[]): Promise<void> {
    const device = await this.devices.findOne({ device_id: device_id });

    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    for (const alarm of alarms) {
      if (!alarm.alarmId) {
        alarm.alarmId = uuidv4();
      }
    }

    await this.devices.updateOne({ device_id: device_id }, { alarms: alarms });
  }

  public async setDeviceCloudSettings(device_id: string, settings: CloudSettings) {
    const device = await this.devices.findOne({ device_id: device_id });

    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    const normalizedSettings = this.normalizeCloudSettings(settings);
    if (!this.isFirmwareChannel(normalizedSettings.firmwareChannel)) {
      throw new HttpException(400, 'Invalid firmware channel');
    }

    const previousPending = effectivePendingFirmware(device);

    if (normalizedSettings.firmwareChannel === 'manual') {
      const requested = normalizedSettings.pendingFirmware?.trim();
      if (!requested) {
        throw new HttpException(400, 'Manual channel requires a firmware version');
      }

      if (requested !== previousPending) {
        const firmware = await this.firmwares.findOne({ firmware_id: requested, class_id: device.class_id });
        if (!firmware) {
          throw new HttpException(400, 'Selected firmware is not available for this device');
        }
      }

      normalizedSettings.pendingFirmware = requested;
    } else {
      normalizedSettings.pendingFirmware = previousPending || undefined;
    }

    device.cloudSettings = normalizedSettings;

    const set: Record<string, any> = { cloudSettings: normalizedSettings, firmwareSettings: {} };
    if (normalizedSettings.firmwareChannel === 'manual' && normalizedSettings.pendingFirmware !== previousPending) {
      set.fwupdate_start = Date.now();
    }

    await this.devices.updateOne({ device_id: device_id }, { $set: set, $unset: { pending_firmware: '' } });
  }

  public async setDeviceName(device_id: string, name: string): Promise<void> {
    const updated = await this.devices.findOneAndUpdate({ device_id: device_id }, { name: name });

    if (!updated) {
      throw new HttpException(404, 'Device not found');
    }
  }

  public async getDeviceConfig(device_id: string, user_id: string, is_admin: boolean, is_demo = false) {
    const device = await this.devices.findOne(deviceAccessFilter(device_id, user_id, is_admin, is_demo), { configuration: 1 });
    return device?.configuration;
  }

  public async getDeviceAlarms(device_id: string, user_id: string, is_admin = false, is_demo = false) {
    const device = await this.devices.findOne(deviceAccessFilter(device_id, user_id, is_admin, is_demo), { alarms: 1 }).lean();
    const alarms = device?.alarms ?? [];
    return is_demo ? demoAlarms(alarms) : alarms;
  }

  public normalizeCloudSettings(cloudSettings: CloudSettings | undefined, firmwareSettings?: { autoUpdate?: boolean }) {
    const settings: CloudSettings = cloudSettings ?? {};

    if (settings.firmwareChannel === undefined) {
      const legacyAutoUpdate = settings.autoFirmwareUpdate ?? firmwareSettings?.autoUpdate;
      if (legacyAutoUpdate === true) {
        settings.firmwareChannel = settings.betaFeatures ? 'beta' : 'stable';
      } else {
        settings.firmwareChannel = 'manual';
      }
    }

    if (settings.vpdLeafTempOffsetDay === undefined) {
      settings.vpdLeafTempOffsetDay = -2;
    }

    if (settings.vpdLeafTempOffsetNight === undefined) {
      settings.vpdLeafTempOffsetNight = 0;
    }

    if (settings.logRtspStreamErrors === undefined) {
      settings.logRtspStreamErrors = true;
    }

    if (!settings.rtspStreamTransport) {
      settings.rtspStreamTransport = 'tcp';
    }

    // An out-of-enum webcamModel would make the strict schema fail the whole
    // save — drop it instead so older/foreign clients keep working.
    if (settings.webcamModel !== undefined && !WEBCAM_MODELS.includes(settings.webcamModel)) {
      delete settings.webcamModel;
    }

    return settings;
  }

  private isFirmwareChannel(channel: unknown): channel is FirmwareChannel {
    return channel === 'stable' || channel === 'beta' || channel === 'alpha' || channel === 'manual';
  }

  public async getDeviceCloudSettings(device_id: string) {
    const device = await this.devices.findOne({ device_id: device_id }, { firmwareSettings: 1, cloudSettings: 1 });
    return this.normalizeCloudSettings(device?.cloudSettings, device?.firmwareSettings);
  }

  public async getDeviceAccessInfo(device_id: string, user_id?: string, is_admin = false, is_demo = false): Promise<DeviceAccessInfo | null> {
    // lean() as in the shared variant below: the demo copy is built by spreading
    // these settings, and a hydrated subdocument carries the whole device - the
    // untouched stream URL, credentials and all - along into the answer.
    const device = await this.devices
      .findOne({ device_id: device_id }, { firmwareSettings: 1, cloudSettings: 1, device_type: 1, name: 1, owner_id: 1, demoDevice: 1 })
      .lean();
    if (!device) {
      return null;
    }

    const cloudSettings = this.normalizeCloudSettings(device.cloudSettings, device.firmwareSettings);
    const isOwned = is_admin || (!!user_id && device.owner_id === user_id);
    const isDemoAccess = is_demo && !!device.demoDevice;

    if (!isOwned && !isDemoAccess) {
      return null;
    }

    return {
      device_id: device_id,
      device_type: device.device_type,
      name: device.name,
      isPublic: false,
      cloudSettings: isDemoAccess ? demoCloudSettings(cloudSettings) : cloudSettings,
    };
  }

  // Access info handed to visitors of a share link: no secrets (the RTSP URL is
  // reduced to a presence flag) and the webcam only when the link includes it.
  public async getSharedDeviceAccessInfo(share: ShareLink): Promise<DeviceAccessInfo | null> {
    // lean() returns plain objects, so spreading below cannot leak mongoose internals.
    const device = await this.devices
      .findOne({ device_id: share.device_id }, { firmwareSettings: 1, cloudSettings: 1, device_type: 1, name: 1 })
      .lean();
    if (!device) {
      return null;
    }

    const cloudSettings = this.normalizeCloudSettings(device.cloudSettings, device.firmwareSettings);

    return {
      device_id: share.device_id,
      device_type: device.device_type,
      name: device.name,
      isPublic: true,
      cloudSettings: {
        ...cloudSettings,
        rtspStream: cloudSettings.rtspStream && share.webcam ? '1' : undefined,
      },
      share: {
        share_id: share.share_id,
        page: share.page,
        editable: share.editable,
        webcam: share.webcam,
        charts: !!share.charts,
        // View-only visitors render the view stored with the link, not the URL.
        query: share.query,
        expiresAt: share.expiresAt ?? null,
      },
    };
  }
}
