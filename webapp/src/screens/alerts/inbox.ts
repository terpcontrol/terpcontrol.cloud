import { DateTime } from 'luxon';
import type { AlarmRule, Alert, OutputLevelWatch, OutputMetric, ReadingWatch, Severity } from '@fg2/shared-types/v1';
import { metricName, ruleTitle } from '@/i18n/alarm-line';
import type { Translate } from '@/i18n/i18n';
import { silentSince, spanLabel } from '@/ui/age';
import { deviceName } from '@/ui/naming';
import type { AlertNames } from './names';

/**
 * How the inbox is ordered, which bound a reading crossed, how long an episode
 * stood and what it is called: worked out from the server's answers, kept out
 * of the card so it can be checked without drawing anything.
 */

const millis = (instant: string) => DateTime.fromISO(instant).toMillis();

/** How bad first, because what is open is read from the top and a phone shows three cards of it. */
export const WORST_FIRST: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** What the order is decided by: an alert of the inbox, or one as a card of Start lists it, which names a device only where the inbox's list was at hand. */
type Ranked = Pick<Alert, 'kind' | 'severity' | 'startedAt' | 'value'> & { deviceId?: string | null };

/** When each device with an open offline alert was last heard. */
export const silentDevices = (open: Ranked[]): Map<string, string> =>
  new Map(open.flatMap(alert => (alert.kind === 'offline' && alert.deviceId ? [[alert.deviceId, silentSince(alert)] as const] : [])));

/** When the device a reading's alert is about was last heard, where it has gone silent since: the reading is as old as that. */
export const heardOf = (alert: Ranked, silent: Map<string, string>): string | null =>
  (alert.kind === 'threshold' && alert.deviceId && silent.get(alert.deviceId)) || null;

/**
 * What is open, the worst first, the clock deciding only between equals - a
 * second critical tent below three warnings is off the bottom of a phone. A
 * reading of a device gone silent is an old one, and stands under everything
 * that is about now - the card saying the device is offline among it. It is
 * the one order: Meldungen lists by it, Start names a place's first by it and
 * ranks its cards by how bad that one is.
 */
export const worstFirst = <T extends Ranked>(open: T[], silent = silentDevices(open)): T[] =>
  [...open].sort(
    (a, b) =>
      Number(heardOf(a, silent) !== null) - Number(heardOf(b, silent) !== null) ||
      WORST_FIRST[a.severity] - WORST_FIRST[b.severity] ||
      millis(b.startedAt) - millis(a.startedAt),
  );

/**
 * The bound the reading went past: the lower edge for a reading below it, the
 * upper for one above, and neither for a reading inside the band - a band may
 * be moved while its episode is open, and an episode older than the copy it
 * keeps of its rule is measured against today's, so naming an edge there
 * would assert a crossing that never happened. The comparison is the
 * engine's: only strictly past the edge is out. Without a reading the rule's
 * first edge stands in.
 */
export const crossedBound = (
  { upper, lower }: Pick<ReadingWatch | OutputLevelWatch, 'upper' | 'lower'>,
  value: number | null,
): { over: boolean; bound: number } | null => {
  if (value === null) {
    if (upper !== null) return { over: true, bound: upper };
    return lower !== null ? { over: false, bound: lower } : null;
  }

  if (lower !== null && value < lower) return { over: false, bound: lower };
  if (upper !== null && value > upper) return { over: true, bound: upper };
  return null;
};

/**
 * When what an alert is about began: the reading that crossed the edge, or for
 * a device gone offline the moment it fell silent rather than the moment the
 * cloud noticed - a card that said "since 20:26 · for 16 min" beside "last
 * heard 5 d ago" was dating one silence two ways.
 */
export const beganAt = (alert: Alert): string => (alert.kind === 'offline' ? silentSince(alert) : alert.startedAt);

/** Whether what an episode that is over was about stands open again: the same rule on the same device, the same silence. */
export const openAgain = (over: Alert, open: Alert[]): boolean =>
  open.some(one => one.ruleId === over.ruleId && one.kind === over.kind && one.deviceId === over.deviceId && one.cameraId === over.cameraId);

/** How many seconds an episode that is over stood. */
const lastedSeconds = (alert: Alert): number => (millis(alert.resolvedAt ?? alert.startedAt) - millis(beganAt(alert))) / 1000;

/**
 * What the rule is called, in the words the alarm rules page calls it by. A
 * rule no longer in hand leaves the name the episode wrote down when it
 * opened, read as every stored name is.
 */
export const ruleName = (t: Translate, alert: Alert, rule: AlarmRule | null): string | null =>
  rule ? ruleTitle(t, rule) : alert.watched ? ruleTitle(t, { name: alert.watched.name }) : null;

const outputName = (t: Translate, output: OutputMetric): string => t(`alerts.output.${output}`, { defaultValue: output });

/** How long an episode that is over stood, for its title: "22 Min", and "kurz" under a minute - a blip has no length worth a figure. */
export const spanOf = (t: Translate, alert: Alert): string => (lastedSeconds(alert) < 60 ? t('alerts.brief') : spanLabel(lastedSeconds(alert)));

/**
 * The event in one sentence: "Luftfeuchte zu hoch" while it stands - an open
 * alert is dated, so its words hold still while they are read - and
 * "Luftfeuchte 22 Min zu hoch" (`span`) once it is over; a device gone quiet and a
 * camera without pictures by their names. Which way a reading left its band
 * is said where the episode's own band - or, without one, the rule as it
 * stands - names the edge it crossed; otherwise the rule's name stands in.
 * Several episodes folded into one row are over without one length (an empty
 * `span`): only the title with a verb in it changes its tense for that.
 */
export const titleOf = (t: Translate, alert: Alert, rule: AlarmRule | null, names: AlertNames, span: string | null): string => {
  // A reading or an output is a lower-case word in a language that has them; the sentence starts with it.
  const said = (key: string, what: string) => {
    const over = span || (span === '' && key === 'running') ? 'Was' : '';
    return t(`alerts.title.${key}${over}`, { what: what.charAt(0).toLocaleUpperCase() + what.slice(1), span });
  };

  if (alert.kind === 'offline') {
    const device = alert.deviceId ? names.devices.get(alert.deviceId) : undefined;
    return said('offline', device ? deviceName(device, t) : (alert.spaceName ?? t('shell.gone.title.device')));
  }
  if (alert.kind === 'camera_stale') return said('camera', (alert.cameraId && names.cameras.get(alert.cameraId)) || t('shell.gone.title.camera'));

  const watch = alert.watched?.watch ?? rule?.watch;
  if (watch?.kind === 'output_running') return said('running', outputName(t, watch.output));
  const crossed = watch ? crossedBound(watch, alert.value ?? alert.extremeValue) : null;
  if (watch && crossed)
    return said(crossed.over ? 'high' : 'low', watch.kind === 'reading' ? metricName(t, watch.metric) : outputName(t, watch.output));

  return ruleName(t, alert, rule) ?? t('alerts.what.threshold');
};
