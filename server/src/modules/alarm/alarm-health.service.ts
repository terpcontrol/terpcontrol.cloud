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
import { heardAt, isOffline } from '@common/v1/value-age';
import { logger } from '@utils/logger';
import { DataService } from '../data/data.service';
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
 *
 * Both are on out of the box and both can be turned off: the offline rule by
 * disabling or silencing it, the stale warning by the switch on the camera. A
 * grower who wants neither says so once; nobody has to go and switch them on.
 */

const TICK_MS = 60 * 1000;

/** What the always-on offline rule is called where a name is shown. */
const OFFLINE_RULE_NAME = 'Device offline';

/** How often a device that stays gone is said to be gone. */
const OFFLINE_REPEAT_SECONDS = 30 * 60;

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
    private readonly data: DataService,
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
    const spoke = await this.spokeAt(devices, at);

    await this.keepStaleWarningOptOut();
    for (const device of devices) await this.checkDevice(device, at, spoke);
    await this.checkCameras(new Map(devices.map(device => [device.id, device])), at, spoke);
  }

  /**
   * When each device was really last heard, which for most of the fleet is the
   * cloud's own note of it and for the rest is a stored reading that is newer
   * than the note.
   *
   * The newest reading is read from the measurement store rather than carried
   * on the device document, because a field on the document could only be
   * filled by a message arriving - and it is exactly the devices that have
   * stopped sending messages whose note is wrong. A device claimed into this
   * cloud has its note stamped by the same ingest that writes the sample, so
   * such a field would repeat `lastSeenAt` for the whole healthy fleet and
   * stand empty on the migrated devices this exists for, until a backfill went
   * to the store anyway. The proof lives in the store, so that is where it is
   * asked for, and there is one answer rather than two that can drift.
   *
   * Only the devices the note already calls gone are asked about. One heard
   * from within the last ten minutes is not about to be called offline, and a
   * reading could only agree with it - the correction shortens a silence and
   * never invents one - so the read covers exactly the devices whose answer it
   * could change. It starts at the oldest of their last messages, because no
   * sample older than that can answer the question being asked of any of them:
   * has this device written anything since the cloud last heard from it.
   */
  private async spokeAt(devices: readonly AlarmDevice[], at: Date): Promise<Map<string, Date>> {
    const quiet = devices.filter(device => device.state.lastSeenAt !== null && isOffline(device.state.lastSeenAt, at));
    if (quiet.length === 0) return new Map();

    const since = new Date(Math.min(...quiet.map(device => device.state.lastSeenAt!.getTime())));
    return this.data.newestSamplesOf(
      quiet.map(device => device.id),
      since,
    );
  }

  /** The instant this device is dated by: its last message, or a stored reading that came after it. */
  private spokeLast(device: AlarmDevice, spoke: Map<string, Date>): Date | null {
    return heardAt(device.state.lastSeenAt, spoke.get(device.id) ?? null);
  }

  /**
   * The stale warning is opted out of rather than into, so a camera that
   * predates the switch has to come up with it on.
   *
   * A schema default only reaches a document being written, and the cameras a
   * migration carried over were written from the old shape by a transform that
   * never heard of this field - so several hundred of them would otherwise
   * arrive with the warning silently off and somebody would have to turn each
   * one on by hand. Filling it in here rather than in a migration step keeps
   * that true whichever way a row arrived, and costs a query that matches
   * nothing from the second pass onwards.
   */
  private async keepStaleWarningOptOut(): Promise<void> {
    await this.cameras.updateMany({ staleWarning: { $exists: false } }, { $set: { staleWarning: true } });
  }

  private async checkDevice(device: AlarmDevice, at: Date, spoke: Map<string, Date>): Promise<void> {
    // A device that has never reported is not a device that has stopped: it is
    // one nobody has plugged in yet, and saying so every minute helps nobody.
    if (!device.state.lastSeenAt) return;

    await this.keepOfflineRule(device);
    // The silence is counted from when the device was last heard and not from
    // the cloud's note of it, so the span the diary states cannot be one the
    // same account's own stored readings run past.
    const spokeLast = this.spokeLast(device, spoke)!;
    const quietSeconds = (at.getTime() - spokeLast.getTime()) / 1000;

    for (const rule of await this.rules.find({ deviceId: device.id, 'watch.metric': 'offline' }).lean<StoredAlarmRule[]>()) {
      // `forSeconds` is patience on top of what already counts as gone, so that
      // a rule asking for an hour means an hour of silence, not an hour of alert.
      const gone = isOffline(spokeLast, at) && quietSeconds >= VALUE_AGE.staleSeconds + rule.forSeconds;
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
            // A controller that has gone quiet is the one alarm nothing else
            // can raise, so it is critical and said again until the device is
            // back, as the decided screen has it. Once written it is the
            // grower's rule: a severity or a repeat they changed stays changed.
            severity: 'critical',
            repeatSeconds: OFFLINE_REPEAT_SECONDS,
            origin: 'always',
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  private async checkCameras(devices: Map<string, AlarmDevice>, at: Date, spoke: Map<string, Date>): Promise<void> {
    for (const camera of await this.cameras.find({ removedAt: null }).lean<CameraDocument[]>()) {
      // Nothing to compare against: a camera that has never delivered a picture
      // is a setup that is not finished, which its own page says better than an
      // alert would.
      if (!camera.state.lastStillAt || this.cannotJudge(camera, devices, spoke)) continue;

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
   * When silence says nothing about the camera. A camera somebody has switched
   * the warning off for, one that is allowed to go dark at night, one switched
   * off while somebody works on the tent, and one behind a controller that is
   * itself away are all quiet for a reason - and the device's own offline alert
   * already says the last out loud.
   *
   * Nothing is resolved either while this holds: an alert raised before the tent
   * went dark stays open until a picture arrives.
   */
  private cannotJudge(camera: CameraDocument, devices: Map<string, AlarmDevice>, spoke: Map<string, Date>): boolean {
    // Somebody has said they do not want to hear about this one. Compared
    // against `false` rather than read as a truth, so that a row written
    // before the field existed - and not yet filled in - is warned about
    // rather than quietly dropped.
    if (camera.staleWarning === false) return true;
    if (camera.nightOff) return true;

    const device = camera.deviceId ? devices.get(camera.deviceId) : undefined;
    if (!device) return !!camera.deviceId;
    if (camera.maintenanceOff && device.state.maintenanceUntil && device.state.maintenanceUntil.getTime() > Date.now()) return true;

    // The same instant the device's own alert is dated by: one file deciding a
    // device is away by two different clocks is the drift this is fixing.
    return isOffline(this.spokeLast(device, spoke));
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
