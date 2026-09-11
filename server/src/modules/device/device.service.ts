import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Alarm, CloudSettings, Device, DeviceListEntry } from '@fg2/shared-types';
import { demoDevice } from '@utils/demo';
import { MODEL } from '../../database/models.module';
import { AlarmService } from '../alarm/alarm.service';
import { WebcamPollerService } from '../image/webcam-poller.service';
import { DeviceCommandService } from './device-command.service';
import { DeviceLogEntry, DeviceLogService } from './device-log.service';
import { DeviceSettingsService } from './device-settings.service';
import { withMaintenanceSecondsLeft } from './device.queries';

// Whether a value read out of a device message parses as a number at all. An
// empty string counts, as `Number('')` is 0 rather than NaN.
const isNumeric = (value: string): boolean => !Number.isNaN(Number(value));

/**
 * The device as a client sees it: the lists it asks for, and the handful of
 * actions that reach past one of the device services into what watches the
 * device - its alarms, its camera. Everything else lives in a service of its
 * own: `DeviceSettingsService`, `DeviceLogService`, `DeviceCommandService`,
 * `DeviceRegistrationService`, the firmware pair and `DeviceMessageService`.
 */
@Injectable()
export class DeviceService {
  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    private readonly logs: DeviceLogService,
    private readonly settings: DeviceSettingsService,
    private readonly commands: DeviceCommandService,
    private readonly alarms: AlarmService,
    private readonly webcams: WebcamPollerService,
  ) {}

  public async findAllDevices(): Promise<Device[]> {
    const devices = await this.devices.find({}).lean();
    return devices.map(device => withMaintenanceSecondsLeft(device)) as Device[];
  }

  public async getDeviceBySerial(serialnumber: number): Promise<Device> {
    const device = await this.devices.findOne({ serialnumber: serialnumber }).lean();
    return (device ? withMaintenanceSecondsLeft(device) : device) as Device;
  }

  public async findUserDevices(user_id: string, is_demo = false): Promise<DeviceListEntry[]> {
    const projection = {
      device_id: 1,
      configuration: 1,
      device_type: 1,
      name: 1,
      maintenance_mode_until: 1,
      cloudSettings: 1,
      hardwareInfo: 1,
      lastseen: 1,
    };

    // lean() gives plain objects: the derived seconds can be attached to them, and
    // the sanitized demo copies cannot carry mongoose internals (or the untouched
    // original) along.
    // The camera password is reported so the server can fetch stills; nothing
    // that reads this list needs it, so it does not leave the server.
    const withoutCameraPassword = <T extends { hardwareInfo?: Record<string, string> }>(device: T): T => {
      if (device.hardwareInfo?.webcam_pwd !== undefined) delete device.hardwareInfo.webcam_pwd;
      return device;
    };

    if (is_demo) {
      const demoDevices = await this.devices.find({ demoDevice: true }, projection).lean();
      return demoDevices.map(device => withMaintenanceSecondsLeft(withoutCameraPassword(demoDevice(device)))) as Device[];
    }

    const devices = await this.devices.find({ owner_id: user_id }, projection).lean();
    return devices.map(device => withMaintenanceSecondsLeft(withoutCameraPassword(device))) as Device[];
  }

  /**
   * A diary entry from a device or from a client on its behalf, which is where
   * the one message that means something beyond the diary can arrive: the
   * device reporting that somebody put it into maintenance mode, which is what
   * suppresses its alarms for as long as it says.
   *
   * Everything the server writes itself goes straight to `DeviceLogService` -
   * none of those messages is a maintenance report.
   */
  public async logMessage(deviceId: string, msg: DeviceLogEntry) {
    const [messageKey, value] = (msg.message ?? '').split(':');
    if (messageKey?.startsWith('message-maintenance-mode-activated') && isNumeric(value)) {
      await this.alarms.maintenanceActivatedForDevice(deviceId, parseInt(value));
    }

    await this.logs.logMessage(deviceId, msg);
  }

  /** Stored alarms are cached for evaluation, so a change has to reach that cache. */
  public async setDeviceAlarms(device_id: string, alarms: Alarm[]): Promise<void> {
    await this.settings.storeDeviceAlarms(device_id, alarms);
    this.alarms.invalidateAlarmCache(device_id);
  }

  /** The camera settings are among them, so the poller stops waiting out a backoff for the old ones. */
  public async setDeviceCloudSettings(device_id: string, settings: CloudSettings): Promise<void> {
    await this.settings.setDeviceCloudSettings(device_id, settings);
    this.webcams.reportDeviceConfigured(device_id);
  }

  /** Told to the device, so it stops acting on its own alarms, and to the cloud's. */
  public async activateMaintenanceMode(device_id: string, durationMinutes: number): Promise<void> {
    this.commands.activateMaintenanceMode(device_id, durationMinutes);
    await this.alarms.maintenanceActivatedForDevice(device_id, durationMinutes);
  }
}
