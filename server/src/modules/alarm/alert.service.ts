import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AlertKind, Severity } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { AlarmDeliveryService } from './alarm-delivery.service';
import { AlarmEvent, GROW_IN_SPACE, GrowInSpace } from './alarm.types';
import { bandOf, watchedName } from './alarm.watch';

/**
 * An alert's life: one document from the moment something is wrong to the moment
 * it is over, rather than the pair of diary lines this used to be.
 *
 * Every change to it also writes the timeline entry that carries its id and
 * hands the message to the delivery, so the three cannot come apart - an alert
 * in the inbox that nobody was told about, or a mail about an episode the inbox
 * does not show, are the failures this file exists to prevent.
 */

/** What the alert is about, in the words a message uses for it. */
export interface AlertSubject {
  /** The rule's name, or the camera's. */
  name: string;
  kind: AlertKind;
  severity: Severity;
  /** Null for what the health loop raised without a rule. */
  rule: StoredAlarmRule | null;
  deviceId: string | null;
  cameraId: string | null;
  spaceId: string | null;
}

@Injectable()
export class AlertService {
  constructor(
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    private readonly entries: EntryWriterService,
    private readonly delivery: AlarmDeliveryService,
    @Optional() @Inject(GROW_IN_SPACE) private readonly grows: GrowInSpace | null = null,
  ) {}

  public openOfRule(ruleId: string): Promise<StoredAlert | null> {
    return this.alerts.findOne({ ruleId, resolvedAt: null }).sort({ startedAt: -1 }).lean();
  }

  /** The episode a repeat is about, which is the open one where there is one and the last one otherwise. */
  public latestOfRule(ruleId: string): Promise<StoredAlert | null> {
    return this.alerts.findOne({ ruleId }).sort({ startedAt: -1 }).lean();
  }

  public openOfCamera(cameraId: string): Promise<StoredAlert | null> {
    return this.alerts.findOne({ cameraId, resolvedAt: null }).sort({ startedAt: -1 }).lean();
  }

  /**
   * Something is wrong, from now until it is not.
   *
   * What the rule was called and what it watched is copied onto the episode
   * here, because here is the only moment it is the episode's own: a band may be
   * moved while the alert is open and the rule may be deleted afterwards
   * entirely, and neither of those should be able to change or erase what this
   * one was about.
   */
  public async raise(subject: AlertSubject, value: number | null, at: Date): Promise<StoredAlert> {
    const alert: StoredAlert = {
      id: uuidv4(),
      createdAt: at,
      ruleId: subject.rule?.id ?? null,
      deviceId: subject.deviceId,
      cameraId: subject.cameraId,
      spaceId: subject.spaceId,
      kind: subject.kind,
      severity: subject.severity,
      startedAt: at,
      resolvedAt: null,
      value,
      extremeValue: value,
      watched: subject.rule ? { name: subject.rule.name, watch: subject.rule.watch } : null,
    };

    await this.alerts.create(alert);
    await this.announce('triggered', subject, alert, value);
    return alert;
  }

  /** It is over. The worst of it stays on the alert, which is the record of the episode. */
  public async settle(subject: AlertSubject, alert: StoredAlert, value: number | null, at: Date): Promise<void> {
    const extremeValue = subject.rule?.state.extremeValue ?? alert.extremeValue;
    await this.alerts.updateOne({ id: alert.id }, { $set: { resolvedAt: at, extremeValue } });
    await this.announce('resolved', subject, { ...alert, resolvedAt: at, extremeValue }, value);
  }

  /**
   * Where it stands, said again because the rule asks to be reminded. Nothing is
   * written to the timeline: the episode is already in it, and a repeat is not a
   * second thing that happened.
   */
  public async repeat(subject: AlertSubject, alert: StoredAlert, value: number | null): Promise<void> {
    const event: AlarmEvent = alert.resolvedAt ? 'resolved' : 'triggered';
    await this.delivery.deliver(event, alert, subject.rule, subject.name, value);
  }

  /** The worst reading of the episode so far, kept on the alert and on the rule alike. */
  public async worsen(alert: StoredAlert, extremeValue: number): Promise<void> {
    await this.alerts.updateOne({ id: alert.id }, { $set: { extremeValue } });
  }

  private async announce(event: AlarmEvent, subject: AlertSubject, alert: StoredAlert, value: number | null): Promise<void> {
    await this.writeEntry(event, subject, alert, value);
    await this.delivery.deliver(event, alert, subject.rule, subject.name, value);
  }

  private async writeEntry(event: AlarmEvent, subject: AlertSubject, alert: StoredAlert, value: number | null): Promise<void> {
    const key = event === 'triggered' ? 'message-alarm-triggered' : 'message-alarm-resolved';

    await this.entries.write({
      source: 'alarm',
      authorId: null,
      values: { kind: 'alarm' },
      occurredAt: event === 'triggered' ? alert.startedAt : (alert.resolvedAt ?? undefined),
      growId: await this.growOf(subject.spaceId),
      spaceId: subject.spaceId,
      deviceId: subject.deviceId,
      cameraId: subject.cameraId,
      alertId: alert.id,
      // An alarm is worth what its rule says it is worth; that it is over is not.
      severity: event === 'triggered' ? subject.severity : 'info',
      message: { key, params: [summary(subject, alert, value, event)] },
    });
  }

  private growOf(spaceId: string | null): Promise<string | null> {
    return spaceId && this.grows ? this.grows.growIdIn(spaceId) : Promise.resolve(null);
  }
}

/**
 * The line the timeline shows, in the words it has always shown it in.
 *
 * Those words are a reading against its thresholds, which is what every alarm
 * the old app could raise was. Silence is not a reading: the health loop hands
 * `offline` and `camera_stale` the seconds since the device or the camera was
 * last heard from, and printing that as `value=374021.218` puts a figure on the
 * grow's own diary that means nothing to the person reading it - while the
 * alert beside it, from the same number, says "last heard 4 d ago". It is
 * written here as a span for that reason, and here rather than in the catalogue
 * because the whole line is already composed on this side.
 *
 * The shape of these lines is a contract, not prose: the webapp reads them back
 * into their parts (`webapp/src/i18n/alarm-line.ts`) and writes them in the
 * reader's language and decimals, as it must for the migrated diaries that hold
 * the same shape. A change here has to be made there as well.
 */
const summary = (subject: AlertSubject, alert: StoredAlert, value: number | null, event: AlarmEvent): string => {
  if (alert.kind === 'offline' || alert.kind === 'camera_stale') return silence(subject, alert, value, event);

  const rule = subject.rule;
  const watched = rule ? bandOf(rule.watch) : null;
  const band = watched && (watched.upper !== null || watched.lower !== null) ? watched : null;

  return (
    `${subject.name} (${rule ? watchedName(rule.watch) : alert.kind}), value=${value}` +
    (band ? `, upper threshold=${band.upper ?? 'n/a'}, lower threshold=${band.lower ?? 'n/a'}` : '') +
    (event === 'resolved' && band ? `, extreme value=${alert.extremeValue ?? 'n/a'}` : '')
  );
};

/**
 * How long it was quiet, for the two alarms that are about nothing arriving.
 *
 * A device that has gone away and a camera that has stopped delivering stills
 * are both raised by the health loop with the silence in seconds, so there is no
 * band to state and no reading to name: what the line has to say is when it was
 * last heard from before the alarm was raised, and how long the episode ran once
 * it was over. The name in front of it is the rule's - "Device offline" - or the
 * camera's, so neither line repeats the metric after it the way a threshold
 * alarm names the reading it watched.
 *
 * It says "last heard" rather than calling the span a silence of readings,
 * because the span is counted from the last thing the device was heard to say -
 * a stored reading as readily as a message - and the liveness vocabulary the
 * rest of the app uses was given that wording for exactly this distinction.
 *
 * The end of it is dated from the alert rather than from the value it is handed:
 * the loop resolves an episode from a fresh measurement of the silence, which is
 * a few seconds by the time anything has been heard again, and "last heard 12 s
 * ago" is not what a four-day absence should be remembered as.
 */
const silence = (subject: AlertSubject, alert: StoredAlert, value: number | null, event: AlarmEvent): string => {
  if (event === 'resolved') {
    const episode = alert.resolvedAt ? (alert.resolvedAt.getTime() - alert.startedAt.getTime()) / 1000 : null;
    return episode === null ? `${subject.name}, back` : `${subject.name}, back after ${spanWords(episode)}`;
  }

  return value === null ? subject.name : `${subject.name}, last heard ${spanWords(value)} ago`;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A span in the words somebody reads it in: "40 s", "12 min", "3 h 20 min",
 * "4 d 7 h". Two units above an hour, because the difference between four days
 * and four and a half is most of what anybody wants from the line, and never
 * more than two, because the third is noise on a figure this rough.
 *
 * It is not the app's `spanLabel`. That one floors to a single unit and is
 * written in the browser, in the reader's language; this goes into
 * `message.params` as the line is composed and is read in whatever language the
 * reader has chosen, exactly as the "upper threshold=" beside it always has.
 */
const spanWords = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < MINUTE) return `${whole} s`;
  if (whole < HOUR) return `${Math.floor(whole / MINUTE)} min`;
  if (whole < DAY) return withRest(Math.floor(whole / HOUR), 'h', Math.floor((whole % HOUR) / MINUTE), 'min');

  return withRest(Math.floor(whole / DAY), 'd', Math.floor((whole % DAY) / HOUR), 'h');
};

const withRest = (count: number, unit: string, rest: number, restUnit: string): string =>
  rest === 0 ? `${count} ${unit}` : `${count} ${unit} ${rest} ${restUnit}`;
