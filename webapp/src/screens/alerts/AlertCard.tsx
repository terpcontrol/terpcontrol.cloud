import type { DateTime } from 'luxon';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Alert, AlarmRule, AlarmWatch, Device, Me, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { useSilenceAlarmRule, useUnsilenceAlarmRule } from '@/api/alarm-rules';
import { useDeviceCommand } from '@/api/commands';
import { clockLabel } from '@/screens/notifications/settings';
import { maintenanceQuiet, parkedLabel, parksAnything, quietMinutes, SETTLE_MINUTES } from '@/ui/maintenance';
import { levelFigure, ruleTitle, unitOf } from '@/screens/control/alarms/rules';
import { ageAttribute, ageLabel, isAhead, spanLabel } from '@/ui/age';
import { clock, zoned, zoneOf } from '@/ui/zone';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { figure, targetFigure } from '../home/units';
import { crossedBound, deliveryOf, lastedLabel } from './inbox';
import type { AlertNames } from './names';
import ask from './AlertCard.module.css';
import styles from './Alerts.module.css';

/** How long a silence from the card holds, and how long maintenance does. */
export const SILENCE_SECONDS = 3600;
export const MAINTENANCE_SECONDS = 900;

/**
 * The three spans the question and the receipt are written around: the window
 * the device is given, the settling the cloud adds to it, and the quiet a
 * grower actually gets, which is their sum. The card used to name the window
 * for all three, so a quarter of an hour was promised for a silence that ran
 * for twenty-five minutes.
 */
const SPANS = { minutes: Math.round(MAINTENANCE_SECONDS / 60), settle: SETTLE_MINUTES, quiet: quietMinutes(MAINTENANCE_SECONDS) };

type Translate = ReturnType<typeof useTranslation>['t'];

interface AlertCardProps {
  alert: Alert;
  /** The rule that raised it, where it still exists; null for a health-loop alert and for a rule since removed. */
  rule: AlarmRule | null;
  names: AlertNames;
  /** The account behind the routing, so the card can say whether anybody was told; undefined until it has answered. */
  me: Me | undefined;
  mayManage: boolean;
  now: DateTime;
}

/**
 * One event, graded by its severity on the left edge and drawn from the
 * server's instants alone. The first line says where and what, the second which
 * rule, how bad, when and for how long; a resolved card keeps both, dimmed and
 * dated, because a night the tent ran hot is still worth reading in the morning.
 *
 * What can be done about it sits on the card, and only while it is open:
 * silence the rule, put the device into maintenance, open the timeline it
 * happened in, or edit the rule. Nothing here claims a device heard a command;
 * what the server answered is said underneath.
 */
export function AlertCard({ alert, rule, names, me, mayManage, now }: AlertCardProps) {
  const { t } = useTranslation();
  const open = alert.resolvedAt === null;
  const device = (alert.deviceId && names.devices.get(alert.deviceId)) || null;
  const { label, figure: reading } = whatOf(t, alert, rule, device, now, zoneOf(me));
  const parts = [...placeOf(t, alert, names, device), { text: label, known: true }];
  const severity = t(`alerts.severity.${alert.severity}`);

  return (
    <li
      className={open ? `${ui.card} ${styles.card}` : `${ui.card} ${ui.joined} ${styles.card}`}
      data-severity={alert.severity}
      aria-label={[severity, ...parts.map(part => part.text), reading].filter(Boolean).join(' · ')}
      {...(open ? {} : ageAttribute('stale'))}
    >
      <div className={styles.lines}>
        <p className={styles.what}>
          {parts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? ' · ' : null}
              {part.known ? part.text : <span className={styles.unnamed}>{part.text}</span>}
            </Fragment>
          ))}
          {reading ? (
            <>
              {' '}
              <span className="mono">{reading}</span>
            </>
          ) : null}
        </p>
        <p className={`mono ${styles.meta}`}>{metaOf(t, alert, rule, device, me, now, severity)}</p>
      </div>

      {open && mayManage ? (
        <OpenChips alert={alert} rule={rule} device={device} now={now} />
      ) : !open && alert.spaceId ? (
        <div className={styles.chips}>
          <TimelineChip spaceId={alert.spaceId} />
        </div>
      ) : null}
    </li>
  );
}

/** A word of the first line, and whether it is a name or the bare id something is known by. */
interface Part {
  text: string;
  known: boolean;
}

/**
 * What something is called, or the id it is known by once a read has come back
 * without a name for it. A list still on its way says nothing rather than
 * flashing an id that a name is about to replace; a list that was refused says
 * the id, because a card whose place has quietly gone missing is a card about
 * nothing in particular.
 */
const nameOrId = (name: string | undefined, id: string, names: AlertNames): Part | null =>
  name !== undefined ? { text: name, known: true } : names.pending ? null : { text: id, known: false };

/**
 * Where it happened: the space, and under it the device where the space holds
 * more than one and naming it is the only way to tell two cards apart. An alert
 * that names no space is placed by the device or the camera it came from.
 */
const placeOf = (t: Translate, alert: Alert, names: AlertNames, device: Device | null): Part[] => {
  if (alert.spaceId) {
    const space = nameOrId(names.spaces.get(alert.spaceId), alert.spaceId, names);
    const crowded = (names.devicesInSpace.get(alert.spaceId) ?? 0) > 1;

    return [space, device && crowded ? { text: deviceName(t, device), known: true } : null].filter(part => part !== null);
  }
  if (alert.deviceId)
    return [device ? { text: deviceName(t, device), known: true } : nameOrId(undefined, alert.deviceId, names)].filter(part => part !== null);
  if (alert.cameraId) return [nameOrId(names.cameras.get(alert.cameraId), alert.cameraId, names)].filter(part => part !== null);

  return [];
};

/** What a device is called, or what kind of thing it is where nobody has named it. */
const deviceName = (t: Translate, device: Device): string => device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type });

// The inbox writes a metric out in full - "humidity" rather than "RH" - so its
// own words come first and the short ones the dense cards elsewhere use stand
// in only where it has none.
const metricName = (t: Translate, metric: Metric): string =>
  t(`alerts.metric.${metric}`, { defaultValue: t(`home.metric.${metric}`, { defaultValue: metric }) });

const outputName = (t: Translate, output: OutputMetric): string => t(`alerts.output.${output}`, { defaultValue: output });

/** What the card says, and the figures in it apart from it, because a figure is set in mono wherever it is drawn. */
interface What {
  label: string;
  figure: string | null;
}

/**
 * The event in as few words as the board allows: the reading and the edge it
 * crossed where the rule is still there to say what it watched, the bare kind
 * where it is not.
 *
 * An offline alert is dated from when the device was last heard rather than
 * from the alert's start, because what a reader wants to know is how long the
 * tent has gone unwatched and not how long ago the cloud noticed. A device this
 * account cannot see leaves the alert's own start as the only answer there is.
 *
 * Last heard is not last sample, and the words say so. A device reports its
 * presence and its readings on different beats, and a migrated one can carry a
 * connect stamped hours before the last figure it stored - so this card said
 * "no sample for 4 d" about a tent whose newest reading the header of its own
 * page dates three days back. The two ages are meant to differ; describing one
 * of them as the other is what made them look like a contradiction.
 * Both instants are the server's, and so is the now they are taken from: a
 * silence is the whole of what such a card says, and a browser an hour out
 * would add that hour to it while the "since" beside it stayed put.
 *
 * A camera alert is dated the same way and for the same reason. It used to
 * print the moment the cloud noticed, which on a real blackout of three days
 * and twenty-two hours read "no image since 13:19 … resolved 13:20 · lasted
 * 1 min" - a camera that looked to have blinked. The staleness is on the alert
 * itself, so the last picture is that many seconds before it was raised, and
 * the date is written beside the hour whenever it is not today's: a gap that
 * began late one night is otherwise moved onto the wrong day by a bare clock.
 */
const whatOf = (t: Translate, alert: Alert, rule: AlarmRule | null, device: Device | null, now: DateTime, zone: string | null): What => {
  switch (alert.kind) {
    case 'offline': {
      if (alert.resolvedAt) return { label: t('alerts.what.wasOffline'), figure: null };
      const quietSince = device?.state.lastSeenAt || alert.startedAt;
      return { label: t('alerts.what.offline', { age: ageLabel(quietSince, now) }), figure: null };
    }
    case 'camera_stale': {
      // The alert carries how long the camera had been dark when it was
      // raised, so the picture it was dark since is that many seconds before
      // the raise. Both an open and a resolved alert are dated this way: an
      // open one has no newer picture by definition, and a resolved one's
      // camera now holds the still that ended the gap, so its live state is
      // the wrong thing to read.
      const quiet = alert.value ?? alert.extremeValue;
      const since = quiet === null ? alert.startedAt : (zoned(alert.startedAt, zone).minus({ seconds: quiet }).toISO() ?? alert.startedAt);

      return { label: t('alerts.what.cameraSince', { time: clockLabel(since, now, zone) }), figure: null };
    }
    case 'threshold': {
      const what = watchedOf(alert, rule);
      return what ? watched(t, alert, what) : { label: t('alerts.what.threshold'), figure: alert.value === null ? null : String(alert.value) };
    }
  }
};

/** A figure and what belongs to it, held together so a narrow card wraps the pair rather than splitting it. */
const tight = (part: string): string => part.replace(/ /g, ' ');

/** What the episode watched, from whichever of the two still knows. */
interface Watched {
  watch: AlarmWatch;
  /** How long the reading had to stay out, which only a rule still in hand can say. */
  forSeconds: number | null;
}

/**
 * What this episode was about. The band and the metric are the episode's own -
 * the copy the alert kept of its rule as the episode opened - and only where it
 * kept none are they read off the rule as it stands today.
 *
 * The copy wins over the rule even while the rule is in hand, because the two
 * part as soon as somebody edits the rule, which the card's own "Edit rule"
 * chip is the supported way to do with the episode still open. Read off the
 * rule, a band widened from 30 to 60 made a card raised on 41 % read
 * "humidity 41 % › 60" - a crossing that never happened - where the episode
 * itself says "› 30", which is the one that did.
 *
 * A rule can also be deleted, and the episodes it raised stay: they are the
 * record of something that happened in a tent, and retiring the rule is not a
 * statement that it did not. Without the copy such a card said "alarm" and a
 * bare figure, with no metric, no unit and no name to tell one deleted rule's
 * night from another's.
 *
 * The rule's name is not taken from here: a renamed rule is still the rule a
 * reader knows it by, so `ruleName()` reads the copy only once the rule is gone.
 * What stays with the live rule alone is what only a rule can answer: the grade
 * it carries today, the silence resting on it, how often it repeats, how long it
 * asks a reading to stay out, and whether it can be edited from here at all.
 */
const watchedOf = (alert: Alert, rule: AlarmRule | null): Watched | null => {
  const watch = alert.watched?.watch ?? rule?.watch;

  return watch ? { watch, forSeconds: rule ? rule.forSeconds : null } : null;
};

const watched = (t: Translate, alert: Alert, { watch, forSeconds }: Watched): What => {
  if (watch.kind === 'output_running') {
    return {
      label: t('alerts.what.running', { output: outputName(t, watch.output) }),
      // A rule that trips the moment its output starts has no span to name, and
      // neither has an episode whose rule is gone: the duration the rule asked
      // for was the rule's and is not part of what happened.
      figure: forSeconds !== null && forSeconds > 0 ? tight(`› ${spanLabel(forSeconds)}`) : null,
    };
  }

  const value = alert.value ?? alert.extremeValue;
  const crossed = crossedBound(watch, value);
  // A reading carries the metric's unit and decimals; a level carries whatever
  // its own output sends. The inbox used to call every level a percent and
  // round it to a whole number, so a heater watched at half power read "1 %" on
  // a series whose whole range is nought to one - and the card beside it, which
  // knew better, wrote the same bound with no unit at all.
  const asFigure = (x: number) => (watch.kind === 'reading' ? figure(x, watch.metric) : levelFigure(x));
  const asEdge = (x: number) => (watch.kind === 'reading' ? targetFigure(x, watch.metric) : levelFigure(x));
  const unit = unitOf(watch);

  const figures = [
    value === null ? null : [asFigure(value), unit].filter(Boolean).join(' '),
    crossed ? `${crossed.over ? '›' : '‹'} ${asEdge(crossed.bound)}` : null,
  ].filter((part): part is string => part !== null);

  return {
    label: watch.kind === 'reading' ? metricName(t, watch.metric) : outputName(t, watch.output),
    figure: figures.length ? figures.map(tight).join(' ') : null,
  };
};

/**
 * Which rule raised it, how much it matters, when it began and how long it
 * stood, then what will go on being done about it. The rule leads the line
 * because two rules on one sensor make two cards that are otherwise word for
 * word the same, and the severity follows it because the coloured edge beside
 * it is the only other place that is said and a colour is not a word.
 *
 * The severity is the alert's own - the grade the episode was raised and
 * announced at - and so is everything said about being told, so that the card
 * cannot promise what the rule would do today about a grade it no longer
 * carries. A rule re-graded while its episode is open carries the change into
 * the alert, so the two only differ where somebody edited the rule before that
 * was so; where they do differ the card says which, rather than quietly
 * reading half from each.
 *
 * Whether anybody was told is said of every open card, whether or not a rule
 * raised it. A camera the health loop found dark carries none, and the server
 * routes it through the same channels a rule's alert goes through - so hanging
 * the clause on the rule left a critical card reading "nobody was listening"
 * above a warning card in exactly that state and silent about it, and a silence
 * where the card beside it names the trouble reads as the assurance that this
 * one did reach somebody. Only what a rule alone can answer - the grade it
 * carries today, the silence resting on it, how often it says itself again -
 * stays behind one, and a card whose rule is merely not in hand goes on saying
 * nothing about delivery at all.
 */
/**
 * Each "·"-separated piece of a short phrase kept on one line - "resolved 18:08",
 * "lasted 56 min" - so the line breaks at a dot and never splits a figure from
 * the word it belongs to.
 */
const whole = (phrase: string): string =>
  phrase
    .split(' · ')
    .map(piece => piece.replace(/ /g, '\u00a0'))
    .join(' · ');

const metaOf = (
  t: Translate,
  alert: Alert,
  rule: AlarmRule | null,
  device: Device | null,
  me: Me | undefined,
  now: DateTime,
  severity: string,
): string => {
  const zone = zoneOf(me);
  const parts = [
    ruleName(t, alert, rule, device),
    severity,
    whole(
      alert.resolvedAt
        ? t('alerts.meta.resolved', { time: clock(alert.resolvedAt, zone), age: lastedLabel(alert, now) })
        : t('alerts.meta.since', { time: clock(alert.startedAt, zone), age: lastedLabel(alert, now) }),
    ),
  ].filter((part): part is string => part !== null);

  if (!alert.resolvedAt) {
    if (rule && rule.severity !== alert.severity) parts.push(t('alerts.meta.ruleNow', { severity: t(`alerts.severity.${rule.severity}`) }));

    const delivery = deliveryOf(alert, rule, me);
    if (delivery === 'repeats' && rule) parts.push(t('alerts.meta.repeats', { every: spanLabel(rule.repeatSeconds) }));
    else if (delivery !== null && delivery !== 'repeats') parts.push(t(`alerts.meta.${delivery}`));

    if (rule && isAhead(rule.silencedUntil, now)) parts.push(t('alerts.meta.silenced', { time: clock(rule.silencedUntil!, zone) }));

    // A device being worked on has its alarms held by the engine itself, so
    // this card will not change while that stands. It is said for the same
    // reason the silence beside it is: what a reader can see of an open alert
    // has to include why nothing more is going to happen to it.
    //
    // Which of the two things is standing is said too. The quiet outlasts the
    // window by the settling, and for those ten minutes the hardware is running
    // again while the alarms are still held - so a card that went on calling
    // the device "in maintenance" was telling a grower their fan was parked
    // when it had been let go, in the very minutes they are most likely to
    // believe the watch is back on. The alarms page one tap away already told
    // the two apart, and the card's own maintenance chip flipped with them
    // while this line did not.
    const quiet = device && maintenanceQuiet(device, now);
    if (quiet) parts.push(t(quiet.parked ? 'alerts.meta.inMaintenance' : 'alerts.meta.settling', { time: clock(quiet.alarmsUntil, zone) }));
  }

  return parts.join(' · ');
};

/**
 * What the rule is called, in the words the alarm rules page calls it by; a
 * device not in hand leaves the name the rule carries, and a rule no longer in
 * hand at all leaves the name the episode wrote down when it opened. The last
 * of those is the plain stored name rather than a title, because a title is
 * made from what the rule is today and there is no today for a rule that is
 * gone.
 */
const ruleName = (t: Translate, alert: Alert, rule: AlarmRule | null, device: Device | null): string | null => {
  if (!rule) return alert.watched?.name ?? null;

  return device ? ruleTitle(t, rule, device) : rule.name;
};

function TimelineChip({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();

  return (
    <Link to={`/spaces/${spaceId}/timeline`} className={ui.chip}>
      {t('alerts.action.timeline')}
    </Link>
  );
}

/**
 * The chips on an open card. A camera that stopped delivering is looked at
 * rather than silenced, so it gets its own page instead of the rule's actions.
 *
 * Maintenance asks before it sends. It is not the quiet version of a silence:
 * where the hardware honours it, the device parks the loops it regulates with
 * as well, so for a quarter of an hour the tent is holding nothing, and a chip
 * that names a duration alone does not say that. The question stands in the
 * place the tap was, the way the plan's own moves ask theirs.
 *
 * What the question promises is read off the device the alert came from. Only a
 * controller and a fridge park anything; the other types have empty command
 * handlers and drop the order silently, so a fan was being told its heater, its
 * dehumidifier and its CO2 valve would stop - none of which it has. On that
 * hardware the fifteen minutes are the cloud's alone, and the question says so
 * rather than describing somebody else's tent.
 */
function OpenChips({ alert, rule, device, now }: { alert: Alert; rule: AlarmRule | null; device: Device | null; now: DateTime }) {
  const { t } = useTranslation();
  // A chip that writes is drawn only where the alert names a device, so the empty id is never sent.
  const deviceId = alert.deviceId ?? '';
  const silence = useSilenceAlarmRule(deviceId);
  const unsilence = useUnsilenceAlarmRule(deviceId);
  const maintenance = useDeviceCommand();
  const [asking, setAsking] = useState(false);
  const silenced = rule !== null && isAhead(rule.silencedUntil, now);
  // Whether the device is already being worked on, so the chip offers the way
  // out of that rather than a second window on top of the one running.
  const parked = device !== null && maintenanceQuiet(device, now)?.parked === true;
  const busy = silence.isPending || unsilence.isPending || maintenance.isPending;
  const camera = alert.kind === 'camera_stale';

  return (
    <>
      <div className={styles.chips}>
        {camera && alert.cameraId ? (
          <Link to={`/cameras/${alert.cameraId}`} className={ui.chip}>
            {t('alerts.action.checkCam')}
          </Link>
        ) : null}
        {!camera && rule && alert.deviceId ? (
          <button
            type="button"
            className={ui.chip}
            disabled={busy}
            onClick={() => (silenced ? unsilence.mutate(rule.id) : silence.mutate({ ruleId: rule.id, body: { forSeconds: SILENCE_SECONDS } }))}
          >
            {t(silenced ? 'alerts.action.unsilence' : 'alerts.action.silence')}
          </button>
        ) : null}
        {/* The chip waits for the device's own row. What maintenance does here
            is a different sentence on a controller and on a fan, so a card that
            cannot yet say which would have to guess, and guessing is what put a
            heater, a dehumidifier and a CO2 valve on a fan in the first place. */}
        {!camera && device && alert.deviceId ? (
          <button
            type="button"
            className={ui.chip}
            disabled={busy}
            aria-expanded={parked ? undefined : asking}
            onClick={() => (parked ? maintenance.mutate({ deviceId, command: { kind: 'maintenance', forSeconds: 0 } }) : setAsking(!asking))}
          >
            {t(parked ? 'alerts.action.endMaintenance' : 'alerts.action.maintenance', { minutes: SPANS.minutes })}
          </button>
        ) : null}
        {alert.spaceId ? <TimelineChip spaceId={alert.spaceId} /> : null}
        {!camera && rule && alert.spaceId ? (
          <Link to={`/spaces/${alert.spaceId}/control/alarms?rule=${rule.id}`} className={ui.chip}>
            {t('alerts.action.editRule')}
          </Link>
        ) : null}
      </div>

      {asking && device ? (
        <div className={ask.asking}>
          <p className={ui.note}>{maintenanceAsk(t, device)}</p>
          <div className={ask.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={busy}
              onClick={() =>
                maintenance.mutate(
                  { deviceId, command: { kind: 'maintenance', forSeconds: MAINTENANCE_SECONDS } },
                  { onSuccess: () => setAsking(false) },
                )
              }
            >
              {t('alerts.maintenance.yes')}
            </button>
            <button type="button" className={ui.button} onClick={() => setAsking(false)}>
              {t('alerts.maintenance.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {maintenance.data && device ? (
        <p className={`mono ${styles.answer}`} role="status">
          {maintenance.variables?.command.kind === 'maintenance' && maintenance.variables.command.forSeconds === 0
            ? t('maintenance.ended')
            : maintenanceReceipt(t, device, maintenance.data.deviceOnline)}
        </p>
      ) : null}
      <Refused error={silence.error ?? unsilence.error ?? maintenance.error} />
    </>
  );
}

/**
 * What maintenance is about to do here, before it is asked for. A device that
 * parks something names what it parks; one whose firmware drops the order says
 * that instead of borrowing a controller's promise.
 */
const maintenanceAsk = (t: Translate, device: Device): string => {
  return parksAnything(device)
    ? t('alerts.maintenance.ask', { ...SPANS, outputs: parkedLabel(t, device) })
    : t('alerts.maintenance.askQuietOnly', SPANS);
};

/**
 * The receipt. Whether anybody was listening only matters where the device has
 * something to do about it: on hardware that drops the order, "the command
 * waits for it" would be a second thing that never happens, so that case is
 * answered the same way whether or not the device was there to hear it.
 */
const maintenanceReceipt = (t: Translate, device: Device, online: boolean): string => {
  if (!parksAnything(device)) return t('alerts.maintenance.sentQuietOnly', SPANS);

  return online ? t('alerts.maintenance.sent', { ...SPANS, outputs: parkedLabel(t, device) }) : t('alerts.maintenance.unheard');
};
