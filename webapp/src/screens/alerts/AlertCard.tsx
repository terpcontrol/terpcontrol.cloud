import { type DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath, devicePath, timelinePath } from '@/app/places';
import type { Alert, AlarmRule, AlarmWatch, Device, Me, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { useRemoveAlert } from '@/api/alerts';
import { ruleTitle } from '@/i18n/alarm-line';
import type { Translate } from '@/i18n/i18n';
import { maintenanceQuiet } from '@/ui/maintenance';
import { repeatsEvery, unitOf } from '@/screens/control/alarms/rules';
import { SilenceChip } from '@/screens/control/alarms/Silence';
import { useSilence } from '@/screens/control/alarms/use-silence';
import { useLog } from '@/log/log-context';
import { ageLabel, isAhead, sinceLabel, spanLabel } from '@/ui/age';
import { clock, zoned, zoneOf } from '@/ui/zone';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Row } from '@/ui/Rows';
import { Sheet } from '@/ui/Sheet';
import { OfflineSteps } from '@/ui/OfflineHelp';
import { figure, targetFigure } from '@/ui/units';
import { beganAt, crossedBound, deliveryOf, lastedLabel } from './inbox';
import type { AlertNames } from './names';
import { looseFigure, unbroken } from '@/ui/figures';
import styles from './Alerts.module.css';
import { deviceName } from '@/ui/naming';

interface AlertProps {
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
 * Something that is wrong now: what, in a sentence; since when, where and how
 * far out; then which rule raised it, how bad, and whether anybody was told.
 * The severity is the card's left edge and a word of the last line, because a
 * colour is not a word. Everything is drawn from the server's instants alone.
 *
 * What can be done about it sits on the card: the curves it happened in, for
 * everybody who sees the place, and for whoever manages it an hour of silence
 * for the rule and the way to the rule. Maintenance is not started from
 * here: it is the place's, on Start and with the device under Steuerung.
 */
export function AlertCard({ alert, rule, names, me, mayManage, now, explainSilence }: AlertProps & { explainSilence?: boolean }) {
  const { t } = useTranslation();
  const device = (alert.deviceId && names.devices.get(alert.deviceId)) || null;
  const severity = t(`alerts.severity.${alert.severity}`);
  const title = titleOf(t, alert, rule, names, now);
  const [steps, setSteps] = useState(false);

  return (
    <li className={styles.card} data-severity={alert.severity} aria-label={`${severity} · ${title}`}>
      <Said alert={alert} rule={rule} names={names} me={me} now={now} title={title} />
      {/* A device gone quiet cannot be told anything from here, so what is offered is what to try in front of it. */}
      {alert.kind === 'offline' ? (
        <>
          <button type="button" className={styles.more} aria-expanded={steps} onClick={() => setSteps(!steps)}>
            {t('offline.help')} ›
          </button>
          {steps ? <OfflineSteps /> : null}
        </>
      ) : null}
      <Actions
        alert={alert}
        rule={rule}
        device={device}
        mayManage={mayManage}
        now={now}
        explainSilence={explainSilence}
        unheard={deliveryOf(alert, rule, me) === 'unheard'}
      />
    </li>
  );
}

/**
 * Something that is over: a row that says what it was and how long ago, and
 * opens the whole of it - when, where, which rule, and the two things left to
 * do with it: look at the curves of that hour, or delete it. A night the tent
 * ran hot is still worth reading in the morning, so nothing is dropped for
 * being old.
 */
export function ResolvedRow(props: AlertProps) {
  const { t } = useTranslation();
  const { alert, rule, names, now } = props;
  const [open, setOpen] = useState(false);
  const title = titleOf(t, alert, rule, names, now);

  return (
    <>
      <Row title={title} line={t('alerts.ago', { age: ageLabel(alert.resolvedAt, now) })} onOpen={() => setOpen(true)} />
      {open ? (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className={styles.whole}>
            <Said {...props} title={null} />
            <Actions {...props} device={null} onRemoved={() => setOpen(false)} />
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** What a card and a resolved alert's sheet say: the title, the line under it, and the line of the rule. */
function Said({ alert, rule, names, me, now, title }: Omit<AlertProps, 'mayManage'> & { title: string | null }) {
  const { t } = useTranslation();
  const device = (alert.deviceId && names.devices.get(alert.deviceId)) || null;
  const zone = zoneOf(me);
  const parts: Part[] = [
    { text: whenOf(t, alert, now, zone), known: true },
    ...placeOf(t, alert, names, device),
    ...[stateOf(t, alert, rule)].flatMap(text => (text ? [{ text, known: true }] : [])),
  ];

  return (
    <div className={styles.said}>
      {title ? <p className={styles.title}>{title}</p> : null}
      <p className={styles.line}>
        <Facts facts={parts.map(part => (part.known ? part.text : <span className={styles.unnamed}>{part.text}</span>))} />
      </p>
      <p className={styles.meta}>
        <Facts facts={metaOf(t, alert, rule, device, me, now)} />
      </p>
    </div>
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
 * Where it happened: the space, and with it the device where the space holds
 * more than one and naming it is the only way to tell two cards apart. An alert
 * that names no space is placed by the device it came from; a camera and a
 * device gone quiet are named by the title.
 */
const placeOf = (t: Translate, alert: Alert, names: AlertNames, device: Device | null): Part[] => {
  if (alert.spaceId) {
    const space = nameOrId(names.spaces.get(alert.spaceId), alert.spaceId, names);
    // The title of a device gone quiet names it already.
    const crowded = alert.kind !== 'offline' && (names.devicesInSpace.get(alert.spaceId) ?? 0) > 1;

    return [space, device && crowded ? { text: deviceName(device, t), known: true } : null].filter(part => part !== null);
  }
  if (alert.deviceId && alert.kind !== 'offline')
    return [device ? { text: deviceName(device, t), known: true } : nameOrId(undefined, alert.deviceId, names)].filter(part => part !== null);

  return [];
};

// The inbox writes a metric out in full - "humidity" rather than "RH" - so its
// own words come first and the short ones the dense cards elsewhere use stand
// in only where it has none.
const metricName = (t: Translate, metric: Metric): string =>
  t(`alerts.metric.${metric}`, { defaultValue: t(`home.metric.${metric}`, { defaultValue: metric }) });

const outputName = (t: Translate, output: OutputMetric): string => t(`alerts.output.${output}`, { defaultValue: output });

/** How long an episode that is over stood, for its title; nothing while it is open - an open one is dated, so its words hold still while they are read. */
const spanOf = (alert: Alert, now: DateTime): string | null => (alert.resolvedAt ? lastedLabel(alert, now) : null);

/**
 * The event in one sentence: "Luftfeuchte zu hoch" while it stands and
 * "Luftfeuchte 22 Min zu hoch" once it is over; a device gone quiet and a
 * camera without pictures by their names. Which way a reading left its band
 * is said where the episode's own band - or, without one, the rule as it
 * stands - names the edge it crossed; otherwise the rule's name stands in.
 */
const titleOf = (t: Translate, alert: Alert, rule: AlarmRule | null, names: AlertNames, now: DateTime): string => {
  const span = spanOf(alert, now);
  // A reading or an output is a lower-case word in a language that has them; the sentence starts with it.
  const said = (key: string, what: string) =>
    t(`alerts.title.${key}${span ? 'Was' : ''}`, { what: what.charAt(0).toLocaleUpperCase() + what.slice(1), span });

  if (alert.kind === 'offline') {
    const device = alert.deviceId ? names.devices.get(alert.deviceId) : undefined;
    return said('offline', device ? deviceName(device, t) : (alert.spaceId && names.spaces.get(alert.spaceId)) || t('shell.gone.title.device'));
  }
  if (alert.kind === 'camera_stale') return said('camera', (alert.cameraId && names.cameras.get(alert.cameraId)) || t('shell.gone.title.camera'));

  const watch = alert.watched?.watch ?? rule?.watch;
  if (watch?.kind === 'output_running') return said('running', outputName(t, watch.output));
  const crossed = watch ? crossedBound(watch, alert.value ?? alert.extremeValue) : null;
  if (watch && crossed)
    return said(crossed.over ? 'high' : 'low', watch.kind === 'reading' ? metricName(t, watch.metric) : outputName(t, watch.output));

  return ruleName(t, alert, rule) ?? t('alerts.what.threshold');
};

/**
 * Since when it stands, or when it began. A device gone offline is dated from
 * when it was last heard rather than from the alert's start, and a camera from
 * its last picture - the staleness is on the alert, so that picture is that
 * many seconds before it was raised: what a reader wants to know is how long
 * the tent has gone unwatched, not how long ago the cloud noticed.
 */
const whenOf = (t: Translate, alert: Alert, now: DateTime, zone: string | null): string => {
  const quiet = alert.kind === 'camera_stale' ? (alert.value ?? alert.extremeValue) : null;
  const began = quiet === null ? beganAt(alert) : (zoned(alert.startedAt, zone).minus({ seconds: quiet }).toISO() ?? alert.startedAt);
  const time = sinceLabel(began, now, zone);

  return alert.resolvedAt ? time : t('alerts.since', { time });
};

/**
 * The third part of the line: how far out it is while it stands - the reading
 * and the edge it crossed, how long an output was asked to pause -, and once
 * it is over that it is. An episode its rule stopped watching - the stage's
 * "too humid" resting in germination - did not get better, and is not said to
 * have.
 */
const stateOf = (t: Translate, alert: Alert, rule: AlarmRule | null): string | null => {
  const what = alert.kind === 'threshold' ? watchedOf(alert, rule) : null;
  if (alert.resolvedAt) return t(`alerts.state.${alert.rested ? 'rested' : what?.watch.kind === 'output_running' ? 'running' : alert.kind}`);

  return what ? figuresOf(t, alert, what) : alert.kind === 'threshold' && alert.value !== null ? String(alert.value) : null;
};

/** What the episode watched, from whichever of the two still knows. */
interface Watched {
  watch: AlarmWatch;
  /** How long the reading had to stay out, which only a rule still in hand can say. */
  forSeconds: number | null;
}

/**
 * What this episode was about. The band and the metric are the episode's own -
 * the copy the alert kept of its rule as the episode opened - and only where it
 * kept none are they read off the rule as it stands today: the two part as
 * soon as somebody edits the rule, and a rule can be deleted while the
 * episodes it raised stay.
 *
 * The rule's name is not taken from here: a renamed rule is still the rule a
 * reader knows it by, so `ruleName()` reads the copy only once the rule is
 * gone. What stays with the live rule alone is what only a rule can answer:
 * the grade it carries today, the silence resting on it, how often it repeats,
 * how long it asks a reading to stay out, and whether it can be edited here.
 */
const watchedOf = (alert: Alert, rule: AlarmRule | null): Watched | null => {
  const watch = alert.watched?.watch ?? rule?.watch;

  return watch ? { watch, forSeconds: rule ? rule.forSeconds : null } : null;
};

const figuresOf = (t: Translate, alert: Alert, { watch, forSeconds }: Watched): string | null => {
  // A rule that trips the moment its output starts has no span to name, and
  // neither has an episode whose rule is gone: the duration the rule asked
  // for was the rule's and is not part of what happened.
  if (watch.kind === 'output_running') {
    return forSeconds !== null && forSeconds > 0 ? unbroken(t('alarms.bound.longer', { duration: spanLabel(forSeconds) })) : null;
  }

  const value = alert.value ?? alert.extremeValue;
  const crossed = crossedBound(watch, value);
  // A reading carries the metric's unit and decimals; a level carries whatever its own output sends.
  const asFigure = (x: number) => (watch.kind === 'reading' ? figure(x, watch.metric) : looseFigure(x));
  const asEdge = (x: number) => (watch.kind === 'reading' ? targetFigure(x, watch.metric) : looseFigure(x));
  const unit = unitOf(watch);

  const figures = [
    value === null ? null : [asFigure(value), unit].filter(Boolean).join(' '),
    crossed
      ? t(crossed.over ? 'alarms.bound.above' : 'alarms.bound.below', { value: [asEdge(crossed.bound), unit].filter(Boolean).join(' ') })
      : null,
  ].filter((part): part is string => part !== null);

  return figures.length ? figures.map(unbroken).join(' · ') : null;
};

/**
 * Which rule raised it and how much it matters, then - while it stands - what
 * will go on being done about it. The rule leads the line because two rules
 * on one sensor make two cards that are otherwise the same. An episode that is
 * over says when it ended.
 *
 * The severity is the alert's own - the grade the episode was raised and
 * announced at - and so is everything said about being told; where the rule's
 * grade differs today the card says which.
 *
 * Whether anybody was told is said of every open card, whether or not a rule
 * raised it: a camera the health loop found dark carries none and is routed
 * through the same channels. Only what a rule alone can answer - the grade it
 * carries today, the silence resting on it, how often it says itself again -
 * stays behind one.
 */
const metaOf = (t: Translate, alert: Alert, rule: AlarmRule | null, device: Device | null, me: Me | undefined, now: DateTime): ReactNode[] => {
  const zone = zoneOf(me);
  const parts: ReactNode[] = [
    ruleName(t, alert, rule),
    t(`alerts.severity.${alert.severity}`),
    alert.resolvedAt ? unbroken(t('alerts.meta.until', { time: sinceLabel(alert.resolvedAt, now, zone) })) : null,
  ].filter((part): part is string => part !== null);

  if (!alert.resolvedAt) {
    if (rule && rule.severity !== alert.severity) parts.push(t('alerts.meta.ruleNow', { severity: t(`alerts.severity.${rule.severity}`) }));

    const delivery = deliveryOf(alert, rule, me);
    if (delivery === 'repeats' && rule) parts.push(t('alerts.meta.repeats', { every: spanLabel(repeatsEvery(rule)) }));
    // Nobody was told for a reason the account can change: said in the warning's colour, with the way there among the card's actions.
    else if (delivery === 'unheard') {
      parts.push(
        <span key="unheard" className={styles.fix}>
          {t('alerts.meta.unheard')}
        </span>,
      );
    } else if (delivery !== null && delivery !== 'repeats') parts.push(t(`alerts.meta.${delivery}`));

    if (rule && isAhead(rule.silencedUntil, now)) parts.push(t('alerts.meta.silenced', { time: clock(rule.silencedUntil!, zone) }));

    // A device being worked on has its alarms held by the engine itself, so this
    // card will not change while that stands, and it says so. Which of the two
    // is standing is said too: the quiet outlasts the window by the settling,
    // and for those minutes the hardware runs again while the alarms are held.
    const quiet = device && maintenanceQuiet(device, now);
    if (quiet) parts.push(t(quiet.parked ? 'alerts.meta.inMaintenance' : 'alerts.meta.settling', { time: clock(quiet.alarmsUntil, zone) }));
  }

  return parts;
};

/**
 * What the rule is called, in the words the alarm rules page calls it by. A
 * rule no longer in hand leaves the name the episode wrote down when it
 * opened, read as every stored name is.
 */
const ruleName = (t: Translate, alert: Alert, rule: AlarmRule | null): string | null =>
  rule ? ruleTitle(t, rule) : alert.watched ? ruleTitle(t, { name: alert.watched.name }) : null;

/**
 * Verlauf of the place, opened on what the episode was about, when it began
 * and on the device it happened to: the curve of the reading it crossed, or
 * the lane of the output it watched, with the cursor on its start - so
 * yesterday's "Zu warm" opens on yesterday, and in a place of two climates on
 * the one that raised it.
 */
const timelineOf = (spaceId: string, alert: Alert, rule: AlarmRule | null): string => {
  const watch = alert.watched?.watch ?? rule?.watch ?? null;
  const focus = !watch ? null : watch.kind === 'reading' ? (watch.metric === 'offline' ? null : watch.metric) : watch.output;

  return timelinePath(spaceId, focus, alert.startedAt, null, null, alert.deviceId);
};

/**
 * What can be done with an alert, each a finger high. Its curves are for
 * everybody who sees the place. While it stands, whoever manages the place
 * may silence its rule for an hour and edit the rule; a camera that stopped
 * delivering is looked at rather than silenced, and a device gone quiet has
 * its own page. Once it is over it can be deleted - asked first, because it
 * goes for everyone the place is shared with.
 */
function Actions({
  alert,
  rule,
  device,
  mayManage,
  now,
  explainSilence,
  unheard = false,
  onRemoved,
}: {
  alert: Alert;
  rule: AlarmRule | null;
  device: Device | null;
  mayManage: boolean;
  now: DateTime;
  /** The first card that offers Silence says once what silencing is. */
  explainSilence?: boolean;
  /** It reached nobody, for a reason the account can change: the way there. */
  unheard?: boolean;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { tell } = useLog();
  // A chip that writes is drawn only where the alert names a device, so the empty id is never sent.
  const silence = useSilence(rule, alert.deviceId ?? '', now);
  const remove = useRemoveAlert();
  const [asking, setAsking] = useState(false);
  const open = alert.resolvedAt === null;
  const camera = alert.kind === 'camera_stale';
  const ruled = open && mayManage && !camera && rule !== null;

  return (
    <>
      <div className={styles.actions}>
        {alert.spaceId ? <Link to={timelineOf(alert.spaceId, alert, rule)}>{t('alerts.action.timeline')}</Link> : null}
        {open && camera && alert.cameraId ? <Link to={`/cameras/${alert.cameraId}`}>{t('alerts.action.checkCam')}</Link> : null}
        {open && alert.kind === 'offline' && device ? <Link to={devicePath(device.id)}>{t('alerts.action.device')}</Link> : null}
        {ruled && alert.deviceId ? <SilenceChip silence={silence} /> : null}
        {ruled && alert.deviceId && explainSilence ? <Help topic="silence" /> : null}
        {ruled && alert.spaceId ? <Link to={controlPath(alert.spaceId, 'alarms', { rule: rule.id })}>{t('alerts.action.editRule')}</Link> : null}
        {open && unheard ? <Link to="/me/notifications">{t('alerts.action.notify')}</Link> : null}
        {!open && mayManage ? (
          <button type="button" disabled={remove.isPending} aria-expanded={asking} onClick={() => setAsking(!asking)}>
            {t('alerts.action.remove')}
          </button>
        ) : null}
      </div>
      {asking ? (
        <Asking
          note={t('alerts.remove.ask')}
          yes={t('alerts.action.remove')}
          danger
          busy={remove.isPending}
          onYes={() =>
            remove.mutate(alert.id, {
              onSuccess: () => {
                tell({ label: t('alerts.told.removed'), undo: null });
                onRemoved?.();
              },
            })
          }
          onCancel={() => setAsking(false)}
        />
      ) : null}
      <Refused error={silence.error ?? remove.error} />
    </>
  );
}
