import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Mutex, MutexInterface, withTimeout } from 'async-mutex';
import { Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { MAINTENANCE_SETTLE_SECONDS, VALUE_AGE } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '../data/data.service';
import { AlertService, AlertSubject } from './alert.service';
import { ALARM_DEVICE_FIELDS, AlarmDevice, MetricSample } from './alarm.types';
import { bandOf, isOutOfBounds, watchedValue } from './alarm.watch';

/**
 * The state machine: what a device just said, the rules watching it, and the
 * alert that opens or closes as a result. A rule watches a reading the device
 * measures or an output it drives, and from here on the two are one thing - the
 * watch answers what tripped it, and everything after that is the same.
 *
 * A rule is only as good as its patience. It triggers when the reading has been
 * out of its band for `forSeconds`, waits out its cooldown before saying so
 * again, repeats itself while nothing changes, and stays quiet while somebody is
 * working on the tent. What is stored for all of that is the rule's own `state`,
 * so a restart picks the episode up where it left off.
 */

/**
 * The device suppresses its own alarms while in maintenance; the cloud's stay
 * quiet a little longer, because a tent is not back at its targets the moment
 * the door shuts. How much longer is the contract's, not this file's: the
 * screens that offer a maintenance window have to promise the same span, and
 * for a while they promised the window alone and were ten minutes short.
 */
const MAINTENANCE_COOLDOWN_MS = MAINTENANCE_SETTLE_SECONDS * 1000;

/** Below this, the duration is noise against the interval a device reports at. */
const MEANINGFUL_FOR_SECONDS = 4;

/** A mail costs the reader more than a webhook does, so it has a floor its rule cannot undercut. */
const MAIL_COOLDOWN_SECONDS = 300;

/** A repeat any more eager than this is a message a minute, whatever the rule says. */
const MINIMUM_REPEAT_SECONDS = 60;

/** A device quiet for this long is away rather than steady: what it reports next starts a new episode. */
const GAP_MS = VALUE_AGE.staleSeconds * 1000;

/** How long a point takes to be worth reading back: the tail of the window is skipped. */
const SETTLED_MS = 4000;

const MUTEX_TIMEOUT_MS = 300000;

@Injectable()
export class AlarmEngineService {
  constructor(
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly data: DataService,
    private readonly alerts: AlertService,
  ) {}

  /** One device at a time: two samples evaluated beside each other would each act on the other's episode. */
  private readonly locks = new Map<string, MutexInterface>();

  /** Per device, the newest sample seen, to tell a steady reading from one either side of a gap. */
  private readonly lastSampleSeen = new Map<string, number>();

  /** Per rule, when the reading was last inside its band. The answer to "for how long already". */
  private readonly insideSince = new Map<string, number>();

  /** Everything a device reported at one instant, against every rule watching one of those readings or outputs. */
  public async onSample(sample: MetricSample): Promise<void> {
    const metrics = Object.keys(sample.values) as Metric[];
    const outputs = Object.keys(sample.outputs) as OutputMetric[];
    if (metrics.length === 0 && outputs.length === 0) return;

    const release = await this.lock(sample.deviceId);
    const at = sample.measuredAt.getTime();

    try {
      const device = await this.deviceOf(sample.deviceId);
      if (!device) return;

      const rules = await this.rules
        .find({ deviceId: device.id, $or: [{ 'watch.metric': { $in: metrics } }, { 'watch.output': { $in: outputs } }] })
        .lean<StoredAlarmRule[]>();
      for (const rule of rules) {
        const value = watchedValue(rule.watch, sample);
        // Asked before the band is, because deciding that costs a query into the
        // stored series for a rule that is patient.
        if (value === undefined || this.saysNothingNew(rule, sample.measuredAt)) continue;

        await this.evaluate(rule, device, value, sample.measuredAt, await this.isOutOfBand(rule, device.id, value, at));
      }
    } finally {
      this.lastSampleSeen.set(sample.deviceId, Math.max(this.lastSampleSeen.get(sample.deviceId) ?? 0, at));
      release();
    }
  }

  /**
   * A verdict nothing measured: the health loop decides whether a device is gone
   * from when it was last heard from, and hands it to the same state machine so
   * that an `offline` rule triggers, waits and repeats like every other one.
   */
  public async onVerdict(rule: StoredAlarmRule, device: AlarmDevice, value: number, outOfBand: boolean, at: Date): Promise<void> {
    const release = await this.lock(device.id);
    try {
      await this.evaluate(rule, device, value, at, outOfBand);
    } finally {
      release();
    }
  }

  /**
   * A rule that is off, and a sample no newer than the one the rule was last
   * evaluated against - a device that reconnects and replays its buffer sends
   * plenty of those.
   */
  private saysNothingNew(rule: StoredAlarmRule, at: Date): boolean {
    return !rule.enabled || (rule.state.lastSampleAt?.getTime() ?? 0) >= at.getTime();
  }

  /**
   * The three things a sample can do to a rule, and which of them the quiet of a
   * maintenance window covers.
   *
   * It covers everything that would be said out loud, which is the turn and the
   * repeat alike. Holding the turn alone kept the promise for an episode that
   * had yet to begin and broke it for one that was already open: the repeat went
   * on going out every minute right through the window, so a rule announced
   * itself twenty-six times inside the twenty-five minutes that the panel asking
   * for the window, the banner over the rules, the chip on Home and the alert's
   * own card had all just called quiet. A repeat is not the lesser half of a
   * raise - routed, it reaches the same phone - and the person it reaches is the
   * one standing in the tent with their hands in it, which is the case this
   * whole feature exists for.
   *
   * The worst reading is still written down, because writing it down tells
   * nobody anything. An episode that runs through a window really does get worse
   * while nothing is being said, and an all-clear afterwards naming a gentler
   * extreme than the tent actually reached would be the record lying about the
   * one stretch nobody was watching.
   */
  private async evaluate(rule: StoredAlarmRule, device: AlarmDevice, value: number, at: Date, outOfBand: boolean): Promise<void> {
    if (this.saysNothingNew(rule, at)) return;

    const workedOn = device.state.maintenanceUntil && device.state.maintenanceUntil.getTime() + MAINTENANCE_COOLDOWN_MS > Date.now();
    if (outOfBand !== rule.state.triggered && !workedOn) {
      await this.turn(rule, device, value, at, outOfBand);
      return;
    }

    if (rule.state.triggered && Number.isFinite(value)) await this.worsen(rule, value, at);
    if (!workedOn) await this.repeat(rule, device, value, at);
  }

  /** The turn itself: what is written down first, and what is said afterwards. */
  private async turn(rule: StoredAlarmRule, device: AlarmDevice, value: number, at: Date, outOfBand: boolean): Promise<void> {
    const now = new Date();
    const subject = subjectOf(rule, device);

    if (!outOfBand) {
      const alert = await this.alerts.openOfRule(rule.id);
      await this.write(rule, at, { 'state.triggered': false, 'state.extremeValue': null, 'state.lastResolvedAt': now });
      if (alert) await this.alerts.settle(subject, alert, value, now);
      return;
    }

    const cooldownSeconds = Math.max(rule.cooldownSeconds, isMailRule(rule) ? MAIL_COOLDOWN_SECONDS : 0);
    if (now.getTime() - (rule.state.lastTriggeredAt?.getTime() ?? 0) < cooldownSeconds * 1000) return;

    await this.write(rule, at, { 'state.triggered': true, 'state.extremeValue': value, 'state.lastTriggeredAt': now });
    await this.alerts.raise(subject, value, now);
  }

  /**
   * The worst reading of an open episode, on the rule and on the alert alike. A
   * rule with no band has no worse: an output that is running is running, and
   * what was written down when it started is the whole of it.
   */
  private async worsen(rule: StoredAlarmRule, value: number, at: Date): Promise<void> {
    const band = bandOf(rule.watch);
    let extreme = rule.state.extremeValue ?? value;
    if (band?.upper != null && value > band.upper) extreme = Math.max(extreme, value);
    if (band?.lower != null && value < band.lower) extreme = Math.min(extreme, value);
    if (extreme === rule.state.extremeValue) return;

    await this.write(rule, at, { 'state.extremeValue': extreme });
    const alert = await this.alerts.openOfRule(rule.id);
    if (alert) await this.alerts.worsen(alert, extreme);
  }

  /**
   * Nothing has changed and the rule asks to be told so again. It repeats where
   * it stands, the all-clear included - a webhook driving somebody's home
   * automation reads the repeat as the heartbeat that says the cloud is still
   * watching. A mail is never repeated: an inbox is not a status display.
   *
   * The heartbeat stops for a device somebody is working on, because the screens
   * that offer the window promise that nothing is raised on it; a heartbeat a
   * grower cannot tell apart from the alarm it carries is not the exception that
   * promise can afford. `evaluate()` is where that is decided, so a repeat that
   * reaches here is one the quiet does not cover.
   */
  private async repeat(rule: StoredAlarmRule, device: AlarmDevice, value: number, at: Date): Promise<void> {
    const since = Math.max(rule.state.lastTriggeredAt?.getTime() ?? 0, rule.state.lastResolvedAt?.getTime() ?? 0);
    const due = since > 0 && since + rule.repeatSeconds * 1000 < Date.now();
    if (isMailRule(rule) || rule.repeatSeconds < MINIMUM_REPEAT_SECONDS || !due) return;

    const now = new Date();
    await this.write(rule, at, rule.state.triggered ? { 'state.lastTriggeredAt': now } : { 'state.lastResolvedAt': now });

    const alert = await this.alerts.latestOfRule(rule.id);
    if (alert) await this.alerts.repeat(subjectOf(rule, device), alert, value);
  }

  private async write(rule: StoredAlarmRule, at: Date, state: Record<string, unknown>): Promise<void> {
    const lastSampleAt = new Date(Math.max(rule.state.lastSampleAt?.getTime() ?? 0, at.getTime()));
    await this.rules.updateOne({ id: rule.id }, { $set: { ...state, 'state.lastSampleAt': lastSampleAt } });
  }

  /**
   * Whether the reading is outside what the rule allows, for long enough.
   *
   * `forSeconds` is answered from what this process has watched where it can be,
   * and from the stored series where it cannot - a rule that has never seen a
   * good reading since the server started would otherwise have to wait its whole
   * duration again after every restart.
   */
  private async isOutOfBand(rule: StoredAlarmRule, deviceId: string, value: number, at: number): Promise<boolean> {
    if (!Number.isFinite(value)) return rule.state.triggered;

    const outside = isOutOfBounds(rule.watch, value);
    if (rule.forSeconds <= MEANINGFUL_FOR_SECONDS) return outside;

    if (!outside) {
      this.insideSince.set(rule.id, at);
      return false;
    }

    // An episode that is already open has served its duration: "for how long"
    // was answered when it triggered. Asking it again of a series that only
    // reaches back `forSeconds` would let a restart sound the all-clear on
    // something that never stopped, and raise it again a sample later.
    if (rule.state.triggered) return true;

    const seenBefore = this.lastSampleSeen.get(deviceId);

    if (seenBefore !== undefined && at - seenBefore >= GAP_MS) {
      // The reading either side of a gap is not a reading held for the duration
      // of it: a device that was away starts its duration again.
      this.insideSince.set(rule.id, at - 5000);
    } else if (!this.insideSince.has(rule.id)) {
      // Nothing watched yet, and no gap to say the device was away either -
      // which is a server that has just started. The series is what remembers
      // the episode across that, and the answer has to be kept: a rule that
      // waits an hour would otherwise restart its clock on every restart, and
      // a fridge that never stops running would never raise the alarm it exists
      // for.
      this.insideSince.set(rule.id, (await this.outOfBoundsSince(rule, deviceId)) ?? Date.now() - 5000);
    }

    const since = this.insideSince.get(rule.id);
    return since === undefined || Date.now() - since >= rule.forSeconds * 1000;
  }

  /**
   * Since when the stored series says the value has been out of the band: the
   * instant it was last inside it, or - where the window holds nothing inside it
   * at all - the oldest point it holds, because that is how far back the episode
   * demonstrably reaches.
   *
   * Null where the window holds no measurement at all. A device with no history
   * says nothing about how long anything has been wrong, and the rule's clock
   * then starts now rather than triggering on silence.
   */
  private async outOfBoundsSince(rule: StoredAlarmRule, deviceId: string): Promise<number | null> {
    // The last few seconds are left out: a point that is still being written
    // reads as an empty window rather than as a good reading.
    const until = Date.now() - SETTLED_MS;
    const window = { startsAt: new Date(until - rule.forSeconds * 1000), endsAt: new Date(until), stepSeconds: 5 };
    const points: SeriesPoint[] =
      rule.watch.kind === 'reading'
        ? await this.data.points(deviceId, rule.watch.metric, window)
        : await this.data.outputPoints(deviceId, rule.watch.output, window);

    // An empty window is a gap in the series, not a measurement of nothing.
    const measured = points.filter((point): point is SeriesPoint & { value: number } => point.value !== null);
    if (measured.length === 0) return null;

    const inside = [...measured].reverse().find(point => !isOutOfBounds(rule.watch, point.value));
    const at = Date.parse(inside?.measuredAt ?? measured[0].measuredAt);

    return isNaN(at) ? null : at;
  }

  private async deviceOf(deviceId: string): Promise<AlarmDevice | null> {
    return this.devices.findOne({ id: deviceId }, ALARM_DEVICE_FIELDS).lean<AlarmDevice>();
  }

  private lock(deviceId: string): Promise<MutexInterface.Releaser> {
    let mutex = this.locks.get(deviceId);
    if (!mutex) {
      mutex = withTimeout(new Mutex(), MUTEX_TIMEOUT_MS, new Error('The alarm engine waited too long for device ' + deviceId));
      this.locks.set(deviceId, mutex);
    }

    return mutex.acquire();
  }
}

/** A rule whose own delivery is a mail: the one that is never repeated and never fires twice in five minutes. */
const isMailRule = (rule: StoredAlarmRule): boolean => rule.delivery.mode === 'custom' && rule.delivery.custom?.channel === 'email';

const subjectOf = (rule: StoredAlarmRule, device: AlarmDevice): AlertSubject => ({
  name: rule.name,
  kind: rule.watch.kind === 'reading' && rule.watch.metric === 'offline' ? 'offline' : 'threshold',
  severity: rule.severity,
  rule,
  deviceId: device.id,
  cameraId: null,
  spaceId: device.spaceId,
});
