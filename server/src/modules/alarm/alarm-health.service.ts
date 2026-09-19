import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { BackgroundWork } from '@common/background-work';
import { isOffline } from '@common/v1/value-age';
import { logger } from '@utils/logger';
import { AlarmEngineService } from './alarm-engine.service';
import { AlertService } from './alert.service';
import { ALARM_DEVICE_FIELDS, AlarmDevice } from './alarm.types';

/**
 * The alarms nothing reports.
 *
 * Every rule but these is answered by a reading arriving; silence is not a
 * reading, so a loop has to go and look. It asks two questions of the fleet: has
 * a device stopped saying anything, and has a camera stopped delivering
 * pictures. The first goes through the same state machine as every other rule -
 * the device carries an `offline` rule the cloud keeps for it - and the second
 * raises an alert of its own, because no threshold can express it.
 */

const TICK_MS = 60 * 1000;

/** What the always-on offline rule is called where a name is shown. */
const OFFLINE_RULE_NAME = 'Device offline';

/**
 * How many stills a camera may miss before it is called stale, and the floor
 * under that: a camera asked every 30 seconds is not stale after two minutes,
 * and one asked every hour is not stale after a quarter of an hour.
 */
const MISSED_STILLS = 10;

@Injectable()
export class AlarmHealthService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    private readonly engine: AlarmEngineService,
    private readonly alerts: AlertService,
  ) {}

  public onModuleInit(): void {
    this.work.repeat('The alarm health loop', () => this.run(), TICK_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the alarm health loop');
    this.work.stop();
  }

  /** One pass over the fleet. Public so it can be run once, in a test or by hand. */
  public async run(at: Date = new Date()): Promise<void> {
    // A device nobody has claimed has nobody to tell, and so has no offline rule.
    const devices = await this.devices.find({ ownerId: { $ne: null } }, ALARM_DEVICE_FIELDS).lean<AlarmDevice[]>();

    for (const device of devices) await this.checkDevice(device, at);
    await this.checkCameras(new Map(devices.map(device => [device.id, device])), at);
  }

  private async checkDevice(device: AlarmDevice, at: Date): Promise<void> {
    // A device that has never reported is not a device that has stopped: it is
    // one nobody has plugged in yet, and saying so every minute helps nobody.
    if (!device.state.lastSeenAt) return;

    await this.keepOfflineRule(device);
    const quietSeconds = (at.getTime() - device.state.lastSeenAt.getTime()) / 1000;

    for (const rule of await this.rules.find({ deviceId: device.id, 'watch.metric': 'offline' }).lean<StoredAlarmRule[]>()) {
      // `forSeconds` is patience on top of what already counts as gone, so that
      // a rule asking for an hour means an hour of silence, not an hour of alert.
      const gone = isOffline(device.state.lastSeenAt, at) && quietSeconds >= VALUE_AGE.staleSeconds + rule.forSeconds;
      await this.engine.onVerdict(rule, device, quietSeconds, gone, at);
    }
  }

  /**
   * The rule the cloud keeps for every device it knows. It is a rule like any
   * other once it exists - it can be silenced, disabled or given a delivery of
   * its own - and it is written once rather than at the moment a device is
   * claimed, so a device that predates this loop gets one too.
   */
  private async keepOfflineRule(device: AlarmDevice): Promise<void> {
    await this.rules
      .findOneAndUpdate(
        { deviceId: device.id, 'watch.metric': 'offline', origin: 'always' },
        {
          $setOnInsert: {
            id: uuidv4(),
            createdAt: new Date(),
            deviceId: device.id,
            name: OFFLINE_RULE_NAME,
            // Field by field rather than as one object: the metric is already in
            // the query the upsert builds the document from, and an update that
            // wrote the whole subdocument would collide with it.
            'watch.kind': 'reading',
            'watch.output': null,
            'watch.upper': null,
            'watch.lower': null,
            severity: 'warning',
            origin: 'always',
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  private async checkCameras(devices: Map<string, AlarmDevice>, at: Date): Promise<void> {
    for (const camera of await this.cameras.find({ removedAt: null }).lean<CameraDocument[]>()) {
      // Nothing to compare against: a camera that has never delivered a picture
      // is a setup that is not finished, which its own page says better than an
      // alert would.
      if (!camera.state.lastStillAt || this.cannotJudge(camera, devices)) continue;

      const open = await this.alerts.openOfCamera(camera.id);
      const quietSeconds = (at.getTime() - camera.state.lastStillAt.getTime()) / 1000;
      const stale = quietSeconds >= Math.max(camera.stillIntervalSeconds * MISSED_STILLS, VALUE_AGE.staleSeconds);

      if (!stale && open) await this.alerts.settle(subjectOf(camera), open, quietSeconds, at);
      // A picture always ends an alert; only raising one asks whether the tent
      // is switched off, and only for a camera that looks quiet.
      if (stale && !open && !(await this.switchedOff(camera.deviceId))) await this.alerts.raise(subjectOf(camera), quietSeconds, at);
    }
  }

  /** A controller in `workmode: off` is not driving its tent, so nothing asks its camera for a picture. */
  private async switchedOff(deviceId: string | null): Promise<boolean> {
    if (!deviceId) return false;

    const device = await this.devices.findOne({ id: deviceId }, { configuration: 1 }).lean();
    return (device?.configuration as { workmode?: unknown } | null)?.workmode === 'off';
  }

  /**
   * When silence says nothing about the camera. A camera that is allowed to go
   * dark at night, one switched off while somebody works on the tent, and one
   * behind a controller that is itself away are all quiet for a reason - and the
   * device's own offline alert already says the third out loud.
   *
   * Nothing is resolved either while this holds: an alert raised before the tent
   * went dark stays open until a picture arrives.
   */
  private cannotJudge(camera: CameraDocument, devices: Map<string, AlarmDevice>): boolean {
    if (camera.nightOff) return true;

    const device = camera.deviceId ? devices.get(camera.deviceId) : undefined;
    if (!device) return !!camera.deviceId;
    if (camera.maintenanceOff && device.state.maintenanceUntil && device.state.maintenanceUntil.getTime() > Date.now()) return true;

    return isOffline(device.state.lastSeenAt);
  }
}

const subjectOf = (camera: CameraDocument) => ({
  name: camera.name,
  kind: 'camera_stale' as const,
  severity: 'warning' as const,
  rule: null,
  deviceId: camera.deviceId,
  cameraId: camera.id,
  spaceId: camera.spaceId,
});
