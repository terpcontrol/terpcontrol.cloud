import i18next from 'i18next';
import { DateTime } from 'luxon';
import type { MetricValue, ValueState } from '@fg2/shared-types/v1';
import { valueStateOfAge } from '@fg2/shared-types/v1-schemas/value-age.js';
import { serverNow } from '@/api/clock';
import { CLOCK, DATED_CLOCK, nowThere, zoned } from './zone';

/**
 * Every value on a screen carries its age: this puts that age into words, says
 * how far the value is dimmed, and re-judges the server's verdict against the
 * clock it is still drawn under - only ever ageing it, never freshening it. "Now"
 * is the server's (`useNow`, `serverNow`), never the browser's clock.
 */

export type DurationUnit = 's' | 'min' | 'h' | 'd';

const SYMBOL: Record<DurationUnit, string> = { s: 's', min: 'min', h: 'h', d: 'd' };

/**
 * How the reader's language abbreviates a unit of time: "d" in English, "T" in
 * German. It is the catalogue's word, so an age and a grow day use one symbol;
 * where no catalogue is loaded, as in a unit test, the English one stands.
 */
export const unitSymbol = (unit: DurationUnit): string => (i18next.exists(`units.${unit}`) ? i18next.t(`units.${unit}`) : SYMBOL[unit]);

/** A figure and its unit of time: "4 min", "3 T". */
export const durationFigure = (figure: number | string, unit: DurationUnit): string => `${figure} ${unitSymbol(unit)}`;

/** "20 s", "4 min", "2 h", "3 d" - short, so it fits beside the figure it belongs to. */
export const ageLabel = (measuredAt: string | null, now: DateTime = serverNow()): string =>
  measuredAt ? spanLabel((now.toMillis() - DateTime.fromISO(measuredAt).toMillis()) / 1000) : '—';

/**
 * The same words for a span somebody hands us in seconds rather than as an
 * instant - how long a device has been quiet, how long an output has run - so
 * that "3 d" means the same thing wherever it is read.
 */
export const spanLabel = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return durationFigure(whole, 's');
  if (whole < 3600) return durationFigure(Math.floor(whole / 60), 'min');
  if (whole < 86_400) return durationFigure(Math.floor(whole / 3600), 'h');
  return durationFigure(Math.floor(whole / 86_400), 'd');
};

/** "30 s", "15 min", "6 h", "24 h": a length somebody chooses, in the coarsest unit the number is whole in. */
export const durationLabel = (seconds: number): string => {
  if (seconds < 60) return durationFigure(seconds, 's');
  if (seconds < 3600 || seconds % 3600 !== 0) return durationFigure(Math.round(seconds / 60), 'min');
  return durationFigure(Math.round(seconds / 3600), 'h');
};

/**
 * The same words for a span that has yet to run: how much of a step is left,
 * how long an override still holds. It rounds up where an age floors, so it
 * never promises less than is left, and carries the unit the rounding fills:
 * 59.5 minutes left is "1 h", not "60 min".
 */
export const countdownLabel = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < 60) return durationFigure(whole, 's');

  const minutes = Math.ceil(whole / 60);
  if (minutes < 60) return durationFigure(minutes, 'min');

  const hours = Math.ceil(whole / 3600);
  return hours < 24 ? durationFigure(hours, 'h') : durationFigure(Math.ceil(whole / 86_400), 'd');
};

/**
 * What `global.css` dims by. It is an attribute rather than a class so a row can
 * pass it straight through to whatever it wraps.
 */
export const ageAttribute = (state: ValueState): { 'data-age': ValueState } => ({ 'data-age': state });

/** Live before quiet before gone: the order two ages are compared and sorted in. */
export const LIVENESS_RANK: Record<ValueState, number> = { live: 0, stale: 1, offline: 2 };

/**
 * The state the contract's constant gives the age of an instant, on the
 * server's clock rather than the reader's, which can be an hour out. Nothing
 * heard at all is offline.
 */
const stateAt = (instant: string | null, now: DateTime): ValueState =>
  instant ? valueStateOfAge((now.toMillis() - DateTime.fromISO(instant).toMillis()) / 1000) : 'offline';

/** How alive a device is, from the last thing it said. No answer carries it, so it is worked out here. */
export const deviceLiveness = (lastSeenAt: string | null, now: DateTime): ValueState => stateAt(lastSeenAt, now);

/**
 * How old a value is *now*, which is what a screen draws it by: the older of the
 * server's verdict and the clock's, so a card that cannot refresh does not go on
 * calling a reading live while its age counts on beside it.
 */
export const valueAge = (value: Pick<MetricValue, 'state' | 'measuredAt'>, now: DateTime = serverNow()): ValueState => {
  const drawn = stateAt(value.measuredAt, now);
  return LIVENESS_RANK[drawn] > LIVENESS_RANK[value.state] ? drawn : value.state;
};

/**
 * When the silence an offline alert is about began: the alert's seconds since
 * the device was last heard, counted back from when it was raised. Every screen
 * counts from this instant, since the raise is only when the cloud noticed.
 */
export const silentSince = (alert: { startedAt: string; value: number | null }): string =>
  alert.value === null ? alert.startedAt : (DateTime.fromISO(alert.startedAt).minus({ seconds: alert.value }).toUTC().toISO() ?? alert.startedAt);

/**
 * The hour of an instant, where the account is: "10:19" today, and with its
 * day on any other, because a bare hour from yesterday reads as one still to
 * come and a mute that ends tomorrow as one already past.
 */
export const sinceLabel = (instant: string, now: DateTime, zone: string | null): string => {
  const at = zoned(instant, zone);
  return at.hasSame(nowThere(now, zone), 'day') ? at.toFormat(CLOCK) : at.toFormat(DATED_CLOCK);
};

/**
 * "offline seit 10:19" - the one way a place or a device gone quiet is said,
 * on the pill, the banner, the card and the alert alike. It is dated rather
 * than aged, so the words do not change while somebody reads them and agree
 * with the hour the last value carries. `start` is the same words opening a
 * sentence.
 */
export const offlineLabel = (since: string | null, now: DateTime, zone: string | null, start = false): string => {
  const words = since ? i18next.t('offline.since', { time: sinceLabel(since, now, zone) }) : i18next.t('offline.never');
  return start ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : words;
};

/** How much of a hold is left, which is a countdown and is rounded as one. */
export const leftLabel = (until: string, now: DateTime): string => countdownLabel((DateTime.fromISO(until).toMillis() - now.toMillis()) / 1000);

/**
 * An instant as the contract carries one: ISO 8601 in UTC, whatever zone the
 * reader is in. A local offset is a different string for the same moment, and
 * the server takes only this one.
 */
export const instantOf = (at: DateTime): string => at.toUTC().toISO()!;

/** Whether an instant is still to come: a silence, a mute or a link that has not run out yet. */
export const isAhead = (instant: string | null, now: DateTime): boolean => instant !== null && DateTime.fromISO(instant) > now;
