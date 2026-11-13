import { type DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath, devicePath, timelinePath } from '@/app/places';
import type { Alert, AlarmRule, AlarmWatch, Device, Me } from '@fg2/shared-types/v1';
import { useRemoveAlerts } from '@/api/alerts';
import type { Translate } from '@/i18n/i18n';
import { maintenanceQuiet } from '@/ui/maintenance';
import { unitOf, willTell } from '@/screens/control/alarms/rules';
import { useSilence } from '@/screens/control/alarms/use-silence';
import { useLog } from '@/log/log-context';
import { dayStamp, sinceLabel, spanLabel } from '@/ui/age';
import { clock, zoned, zoneOf } from '@/ui/zone';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { useKept } from '@/ui/kept';
import { Menu } from '@/ui/Menu';
import { Refused } from '@/ui/PageState';
import { Row } from '@/ui/Rows';
import { Sheet } from '@/ui/Sheet';
import { OfflineSteps } from '@/ui/OfflineHelp';
import { figure, targetFigure } from '@/ui/units';
import { beganAt, crossedBound, ruleName, spanOf, titleOf } from './inbox';
import type { AlertNames } from './names';
import { looseFigure, unbroken } from '@/ui/figures';
import styles from './Alerts.module.css';
import { deviceName } from '@/ui/naming';

interface AlertProps {
  alert: Alert;
  /** The rule that raised it, where it still exists; null for a health-loop alert and for a rule since removed. */
  rule: AlarmRule | null;
  names: AlertNames;
  /** The account behind the routing and the clock times; undefined until it has answered. */
  me: Me | undefined;
  mayManage: boolean;
  /** Whether the place it names is one in use: a place that has ended has no Verlauf to open. */
  placed: boolean;
  now: DateTime;
}

/**
 * Something that is wrong now: what, in a sentence; since when, where and how
 * far out; then which rule raised it, how bad, and what will be done to tell
 * the reader. The severity is the card's left edge and a word of the last
 * line, because a colour is not a word. Everything is drawn from the server's
 * instants alone.
 *
 * What can be done about it is one row: the curves it happened in, for
 * everybody who sees the place, and behind ⋯ the rest. Maintenance is not
 * started from here: it is the place's, on Start and with the device under
 * Steuerung.
 */
export function AlertCard({ heardAt = null, ...props }: AlertProps & { heardAt?: string | null }) {
  const { t } = useTranslation();
  const { alert, rule, names, me, now } = props;
  const severity = t(`alerts.severity.${alert.severity}`);
  const title = titleOf(t, alert, rule, names, null);
  const told = tellOf(t, alert, rule, me, now);
  const [steps, setSteps] = useKept(`steps-${alert.id}`, false);

  return (
    <li className={styles.card} data-severity={alert.severity} aria-label={`${severity} · ${title}`}>
      <Said {...props} title={title} told={told} heardAt={heardAt} />
      {/* A device gone quiet cannot be told anything from here, so what is offered is what to try in front of it. */}
      {alert.kind === 'offline' ? (
        <>
          <button type="button" className={styles.more} aria-expanded={steps} onClick={() => setSteps(!steps)}>
            {t('offline.help')} ›
          </button>
          {steps ? <OfflineSteps /> : null}
        </>
      ) : null}
      <Actions {...props} title={title} unreached={told?.unreached} />
    </li>
  );
}

/**
 * Something that is over: a row that says what it was, where and when it
 * ended, and opens the whole of it - how far it went, which rule, and the two
 * things left to do with it: look at the curves of that hour, or delete it.
 * Episodes of one kind on one day are one row (`fold`, their ids, and
 * `since`), which opens the newest and deletes them all. The row says where
 * (`elsewhere`) unless that is the reader's only place; `again` is the same
 * thing standing open once more, of which nothing is said to be back in range.
 */
export function ResolvedRow(props: AlertProps & { fold: string[]; since: string; elsewhere: boolean; again: boolean }) {
  const { t } = useTranslation();
  const { alert, rule, names, me, now, fold, since, elsewhere } = props;
  const [open, setOpen] = useKept(`whole-${alert.id}`, false);
  const zone = zoneOf(me);
  const title = titleOf(t, alert, rule, names, spanOf(t, alert));
  const count = fold.length;
  const line = [
    elsewhere ? alert.spaceName : null,
    dayStamp(alert.resolvedAt ?? alert.startedAt, now, zone),
    count > 1 ? t('home.entryRepeats', { count, since: sinceLabel(since, now, zone) }) : null,
  ];

  return (
    <>
      <Row title={count > 1 ? titleOf(t, alert, rule, names, null) : title} line={<Facts facts={line} />} onOpen={() => setOpen(true)} />
      {open ? (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className={styles.whole}>
            <Said {...props} title={null} />
            <Actions {...props} title={title} onRemoved={() => setOpen(false)} />
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** What `willTell` says of an open alert, or null where the card says nothing about it. */
type Told = ReturnType<typeof willTell> | null;

/**
 * What will be done to tell the reader about an alert that stands, asked of
 * the grade the episode was raised at, which the server announces it by. What
 * has been done is not said: nothing the page reads records it. An alert that
 * names a rule the list has not answered for says nothing either - the rule
 * is what would say whether it addresses a target of its own.
 */
const tellOf = (t: Translate, alert: Alert, rule: AlarmRule | null, me: Me | undefined, now: DateTime): Told =>
  alert.resolvedAt !== null || (alert.ruleId !== null && rule === null) ? null : willTell(t, alert.severity, rule, me, now);

/** What a card and a resolved alert's sheet say: the title, the line under it, and the line of the rule. */
function Said({
  alert,
  rule,
  names,
  me,
  now,
  title,
  told = null,
  heardAt = null,
  again = false,
}: Omit<AlertProps, 'mayManage' | 'placed'> & { title: string | null; told?: Told; heardAt?: string | null; again?: boolean }) {
  const { t } = useTranslation();
  const device = (alert.deviceId && names.devices.get(alert.deviceId)) || null;
  const zone = zoneOf(me);
  const facts = [
    whenOf(t, alert, now, zone),
    ...placeOf(t, alert, names, device),
    ...stateOf(t, alert, rule, heardAt ? t('alerts.last', { time: sinceLabel(heardAt, now, zone) }) : null, again),
  ];

  return (
    <div className={styles.said}>
      {title ? <p className={styles.title}>{title}</p> : null}
      <p className={styles.line}>
        <Facts facts={facts} />
      </p>
      <p className={styles.meta}>
        <Facts facts={metaOf(t, alert, rule, device, me, now, told)} />
      </p>
    </div>
  );
}

/**
 * Where it stands or happened: the place by the name the alert carries, and
 * with it the device where another one stands there and naming it is the only
 * way to tell two cards apart. An alert that names no place is placed by the
 * device it came from; a camera and a device gone quiet are named by the title.
 */
const placeOf = (t: Translate, alert: Alert, names: AlertNames, device: Device | null): string[] => {
  const told =
    device !== null &&
    alert.kind !== 'offline' &&
    (alert.spaceName === null || [...names.devices.values()].some(one => one.id !== device.id && one.spaceId === alert.spaceId));

  return [alert.spaceName, told ? deviceName(device, t) : null].filter(part => part !== null);
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
 * The rest of the line: how far out it is while it stands - the reading, how
 * old that is where the device has gone silent since (`last`), and the edge it
 * crossed, or how long an output was asked to pause -, and once it is over
 * how far it went and that it is over. An episode its rule stopped watching -
 * the stage's "too humid" resting in germination - did not get better, and is
 * not said to have; neither is one whose rule stands open again (`again`),
 * which the line under it dates the end of.
 */
const stateOf = (t: Translate, alert: Alert, rule: AlarmRule | null, last: string | null, again: boolean): string[] => {
  const what = alert.kind === 'threshold' ? watchedOf(alert, rule) : null;
  const figures = what ? figuresOf(t, alert, what, last) : [];
  if (alert.resolvedAt && again) return figures;
  if (alert.resolvedAt)
    return [...figures, t(`alerts.state.${alert.rested ? 'rested' : what?.watch.kind === 'output_running' ? 'running' : alert.kind}`)];

  return what || alert.kind !== 'threshold' || alert.value === null ? figures : [String(alert.value)];
};

/** What the episode watched, from whichever of the two still knows. */
interface Watched {
  watch: AlarmWatch;
  /** How long the reading had to stay out, which only a rule still in hand can say. */
  forSeconds: number | null;
}

/**
 * What this episode was about. The band and the metric are the episode's own -
 * the copy the alert kept of its rule as it opened - and only where it kept
 * none are they read off the rule as it stands today: the two part as soon as
 * somebody edits the rule, and a rule can be deleted while its episodes stay.
 * The rule's name is not taken from here: a renamed rule is still the rule a
 * reader knows it by (`ruleName`).
 */
const watchedOf = (alert: Alert, rule: AlarmRule | null): Watched | null => {
  const watch = alert.watched?.watch ?? rule?.watch;

  return watch ? { watch, forSeconds: rule ? rule.forSeconds : null } : null;
};

const figuresOf = (t: Translate, alert: Alert, { watch, forSeconds }: Watched, last: string | null): string[] => {
  const over = alert.resolvedAt !== null;
  // A rule that trips the moment its output starts has no span to name, and
  // neither has an episode whose rule is gone: the duration the rule asked
  // for was the rule's and is not part of what happened.
  if (watch.kind === 'output_running') {
    return !over && forSeconds !== null && forSeconds > 0 ? [unbroken(t('alarms.bound.longer', { duration: spanLabel(forSeconds) }))] : [];
  }

  // While it stands the reading that raised it, once it is over the worst of it.
  const value = over ? alert.extremeValue : (alert.value ?? alert.extremeValue);
  if (over && value === null) return [];
  const crossed = crossedBound(watch, value);
  // A reading carries the metric's unit and decimals; a level carries whatever its own output sends.
  const withUnit = (text: string) => [text, unitOf(watch)].filter(Boolean).join(' ');
  const asFigure = (x: number) => withUnit(watch.kind === 'reading' ? figure(x, watch.metric) : looseFigure(x));
  const asEdge = (x: number) => withUnit(watch.kind === 'reading' ? targetFigure(x, watch.metric) : looseFigure(x));

  return [
    value === null ? null : over ? t('alarmLine.worst', { value: asFigure(value) }) : asFigure(value),
    last,
    crossed ? t(crossed.over ? 'alarms.bound.above' : 'alarms.bound.below', { value: asEdge(crossed.bound) }) : null,
  ].flatMap(part => (part === null ? [] : [unbroken(part)]));
};

/**
 * Which rule raised it and how much it matters, then - while it stands - what
 * will go on being done about it (`told`). The rule leads the line because
 * two rules on one sensor make two cards that are otherwise the same. An
 * episode that is over says when it ended.
 *
 * The severity is the alert's own - the grade the episode was raised and is
 * announced at; where the rule's grade differs today the card says which.
 */
const metaOf = (
  t: Translate,
  alert: Alert,
  rule: AlarmRule | null,
  device: Device | null,
  me: Me | undefined,
  now: DateTime,
  told: Told,
): ReactNode[] => {
  const zone = zoneOf(me);
  const parts: ReactNode[] = [
    ruleName(t, alert, rule),
    t(`alerts.severity.${alert.severity}`),
    alert.resolvedAt ? unbroken(t('alerts.meta.until', { time: sinceLabel(alert.resolvedAt, now, zone) })) : null,
  ].filter((part): part is string => part !== null);
  if (alert.resolvedAt) return parts;

  if (rule && rule.severity !== alert.severity) parts.push(t('alerts.meta.ruleNow', { severity: t(`alerts.severity.${rule.severity}`) }));
  parts.push(...(told?.said ?? []));
  // Nobody is told for a reason the account can change: said in the warning's colour, with the way there behind the card's ⋯.
  if (told?.unreached) {
    parts.push(
      <span key="unreached" className={styles.fix}>
        {t('alarms.tell.nobody')}
      </span>,
    );
  }

  // A device being worked on has its alarms held by the engine itself, so this
  // card will not change while that stands, and it says so. Which of the two
  // is standing is said too: the quiet outlasts the window by the settling,
  // and for those minutes the hardware runs again while the alarms are held.
  const quiet = device && maintenanceQuiet(device, now);
  if (quiet) parts.push(t(quiet.parked ? 'alerts.meta.inMaintenance' : 'alerts.meta.settling', { time: clock(quiet.alarmsUntil, zone) }));

  return parts;
};

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
 * What can be done with an alert, in one row. Its curves are for everybody
 * who sees the place, and a camera that stopped delivering is looked at.
 * Behind ⋯ is the rest - one thing alone stands in the row itself: the page
 * of a device gone quiet; for whoever manages the place the device stands in
 * an hour of silence for the rule - which holds for everybody - and the rule
 * itself; and the notification settings where the alert reaches nobody. Once
 * it is over it can be deleted, a folded row whole (`fold`) - asked first,
 * because it goes for everyone the place is shared with.
 */
function Actions({
  alert,
  rule,
  names,
  mayManage,
  placed,
  now,
  title,
  unreached = false,
  fold = [alert.id],
  onRemoved,
}: AlertProps & { title: string; unreached?: boolean; fold?: string[]; onRemoved?: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  // The silence is offered only where the alert names a device, so the empty id is never sent.
  const silence = useSilence(rule, alert.deviceId ?? '', now);
  const remove = useRemoveAlerts();
  const [asking, setAsking] = useState(false);
  const count = fold.length;
  const open = alert.resolvedAt === null;
  const camera = alert.kind === 'camera_stale';
  const ruled = open && mayManage && !camera && rule !== null;
  const more = [
    open && alert.kind === 'offline' && alert.deviceId && names.devices.has(alert.deviceId) ? (
      <Link key="device" to={devicePath(alert.deviceId)}>
        {t('alerts.action.device')}
      </Link>
    ) : null,
    ruled && alert.deviceId ? (
      <button key="silence" type="button" disabled={silence.busy} onClick={silence.toggle}>
        {t(silence.silenced ? 'alerts.action.unsilenceRule' : 'alerts.action.silenceRule')}
        {alert.spaceId ? <span className={styles.line}>{t('alerts.action.forAll')}</span> : null}
      </button>
    ) : null,
    ruled && alert.spaceId ? (
      <Link key="rule" to={controlPath(alert.spaceId, 'alarms', { rule: rule.id })}>
        {t('alerts.action.editRule')}
      </Link>
    ) : null,
    open && unreached ? (
      <Link key="notify" to="/me/notifications">
        {t('alerts.settings')}
      </Link>
    ) : null,
  ].filter(item => item !== null);

  return (
    <>
      <div className={styles.actions}>
        {alert.spaceId && placed ? <Link to={timelineOf(alert.spaceId, alert, rule)}>{t('alerts.action.timeline')}</Link> : null}
        {open && camera && alert.cameraId ? <Link to={`/cameras/${alert.cameraId}`}>{t('alerts.action.checkCam')}</Link> : null}
        {more.length > 1 ? <Menu label={t('grow.menu.label', { name: title })}>{more}</Menu> : more}
        {!open && mayManage ? (
          <button type="button" disabled={remove.isPending} aria-expanded={asking} onClick={() => setAsking(!asking)}>
            {t('alerts.action.remove')}
          </button>
        ) : null}
      </div>
      {asking ? (
        <Asking
          note={t('alerts.remove.ask', { count })}
          yes={count > 1 ? t('alerts.remove.many', { count }) : t('alerts.action.remove')}
          danger
          busy={remove.isPending}
          onYes={() =>
            remove.mutate(fold, {
              onSuccess: () => {
                tell({ label: t('alerts.told.removed', { count }), undo: null });
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
