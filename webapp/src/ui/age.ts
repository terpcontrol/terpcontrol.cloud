import i18next from 'i18next';
import { DateTime, Duration } from 'luxon';
import type { MetricValue, ValueState } from '@fg2/shared-types/v1';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas/value-age.js';
import { serverNow } from '@/api/clock';

/**
 * Every value on a screen carries its age: this puts that age into words, says
 * how far the value is dimmed, and re-judges the verdict that came with it
 * against the clock it is still being drawn under.
 *
 * Whether a value is live, stale or offline is the server's answer on the
 * normal path - it has the clock and the one constant, and it is the only side
 * that decides anything a device or another client is told. But a screen goes
 * on drawing the answer it last got, and a refresh that fails leaves it drawing
 * that answer for as long as the reader looks: a verdict of "live" then outlives
 * the reading it was computed from and asserts the opposite of `VALUE_AGE`. So
 * the verdict is recomputed here from the same shared constant, exactly as
 * `deviceLiveness` already does for hardware, and never overrules the server in
 * the kind direction - the answer can only be aged further, never freshened.
 *
 * The instants being aged are the server's, so the "now" they are measured
 * against is the server's too: `useNow` hands it to a screen on a beat, and the
 * few callers with no beat of their own take it from `serverNow` here. Neither
 * reads the browser's clock, which can be an hour out and would age everything
 * on the screen by that hour.
 */

export type DurationUnit = 's' | 'min' | 'h' | 'd';

const SYMBOL: Record<DurationUnit, string> = { s: 's', min: 'min', h: 'h', d: 'd' };

/**
 * How the reader's language abbreviates a unit of time: "d" in English, "T" in
 * German. It is the catalogue's word and not one written here, because German
 * had a day as "T" on the grow screens and as "d" in every age beside them -
 * "Tag 28" over "vor 5 d" on one page - and an hour as "h", "Std" and "Std.".
 * Where no catalogue is loaded, as in a unit test, the English symbol stands.
 */
export const unitSymbol = (unit: DurationUnit): string => (i18next.exists(`units.${unit}`) ? i18next.t(`units.${unit}`) : SYMBOL[unit]);

/** A figure and its unit of time: "4 min", "3 T". */
export const durationFigure = (figure: number | string, unit: DurationUnit): string => `${figure} ${unitSymbol(unit)}`;

/** "20 s", "4 min", "2 h", "3 d" - short, so it fits beside the figure it belongs to. */
export const ageLabel = (measuredAt: string | null, now: DateTime = serverNow()): string => {
  if (!measuredAt) return '—';
  const elapsed = Duration.fromMillis(Math.max(0, now.toMillis() - DateTime.fromISO(measuredAt).toMillis()));
  const seconds = Math.floor(elapsed.as('seconds'));
  if (seconds < 60) return durationFigure(seconds, 's');
  if (seconds < 3600) return durationFigure(Math.floor(seconds / 60), 'min');
  if (seconds < 86_400) return durationFigure(Math.floor(seconds / 3600), 'h');
  return durationFigure(Math.floor(seconds / 86_400), 'd');
};

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

/**
 * The same words for a span that has yet to run rather than one that already
 * has: how much of a step is left, how long an override still holds.
 *
 * It rounds the other way, and that is the whole of the difference. An age is
 * floored because a thing that happened four and a half days ago did happen
 * four days ago, and saying "5 d" of it would claim time that has not passed.
 * A countdown flooded the same way claims the opposite: a seven-day step read
 * "6 d left" in the moment it began, a full day short of the length the same
 * card printed one line above it, and it went on reading a day short for the
 * whole of every day it crossed - which is exactly the window somebody decides
 * in whether to flush or harvest before the step turns over.
 *
 * Rounding up can only overstate what is left, never promise less of it than
 * there is, and the caller stops drawing the line when nothing is left, so it
 * never counts down to a "0 s" that is not zero. The unit is carried when the
 * rounding fills it - 59 minutes and a half left is "1 h", not "60 min".
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

const RANK: Record<ValueState, number> = { live: 0, stale: 1, offline: 2 };

/**
 * The arithmetic the server does in `valueStateAt`, said once here in the
 * client's own terms, so that a screen judging a reading it is still drawing
 * uses the shared seconds and not a second copy of them.
 */
const stateAt = (measuredAt: string | null, now: DateTime): ValueState => {
  if (!measuredAt) return 'offline';
  const seconds = (now.toMillis() - DateTime.fromISO(measuredAt).toMillis()) / 1000;
  if (seconds < VALUE_AGE.liveSeconds) return 'live';
  return seconds < VALUE_AGE.staleSeconds ? 'stale' : 'offline';
};

/**
 * How old a value is *now*, which is what a screen draws it by.
 *
 * The state the answer carries was true when the answer was made. A card that
 * cannot refresh - the network is gone, the server is restarting - keeps that
 * state while its age counts on beside it, so a reading the app's own constant
 * calls offline goes on wearing the word "live" at full brightness. The reader
 * is told the age three times over and the badge contradicts all three.
 *
 * So the verdict is the older of the two: the server's, which knows things the
 * client does not, and the clock's. `serverNow` is never earlier than the
 * instant the answer was stamped, so the recomputation can only agree with the
 * server or age the value further; taking the worse of the pair is what makes
 * that a guarantee rather than an assumption about clock offset.
 */
export const valueAge = (value: Pick<MetricValue, 'state' | 'measuredAt'>, now: DateTime = serverNow()): ValueState => {
  const drawn = stateAt(value.measuredAt, now);
  return RANK[drawn] > RANK[value.state] ? drawn : value.state;
};

export const isStale = (value: Pick<MetricValue, 'state' | 'measuredAt'>, now: DateTime = serverNow()): boolean => valueAge(value, now) !== 'live';

/**
 * How alive a device is, from the last thing it said.
 *
 * The server decides the state of a *value* and answers it; a device's own
 * liveness is in no answer, so it is worked out here - against the contract's
 * one constant rather than a second copy of those seconds, and against the
 * clock that stamped `lastSeenAt` rather than the one the reader's laptop
 * keeps. A verdict is the whole of what a row says about a device, so a browser
 * an hour fast would otherwise call four live devices dead and sort them to the
 * top of the list for it.
 */
/**
 * When a device was last heard, from everything a screen holds that proves it.
 *
 * `lastSeenAt` is the cloud's note of the last message it took from the device,
 * and the ingest stamps it on every one, so on a device claimed into this cloud
 * the two can never part. The devices carried over from the old one were given
 * the last *connection* the old cloud recorded, which for a fleet that went on
 * reporting for another half day afterwards is simply older than the truth: a
 * row read "offline · 4 d" directly above its own light output at "60 % · 3 d
 * ago", which is the same device saying it was heard a day later than the row
 * claimed.
 *
 * A stored reading is proof the device was heard, so the later of the two is
 * taken. It can only shorten a silence and never invent one, which is what
 * makes it safe to prefer over the raw field: no device is made to look present
 * by a reading older than the last message from it.
 */
/**
 * When the silence an offline alert is about began.
 *
 * The health loop raises it with the seconds since the device was last heard -
 * counted by the server's own `heardAt`, the later of its last message and its
 * newest stored reading - so the start of the silence is that many seconds
 * before the raise. Every screen that says how long a device has been quiet
 * counts from this one instant: the raise itself is only when the cloud noticed,
 * which after a restore is minutes ago about a device silent for days, and the
 * figure in the alert is frozen at the raise while this goes on counting.
 */
export const silentSince = (alert: { startedAt: string; value: number | null }): string =>
  alert.value === null ? alert.startedAt : (DateTime.fromISO(alert.startedAt).minus({ seconds: alert.value }).toUTC().toISO() ?? alert.startedAt);

export const heardAt = (lastSeenAt: string | null, measuredAt: string | null): string | null => {
  if (!lastSeenAt) return measuredAt;
  if (!measuredAt) return lastSeenAt;
  return measuredAt > lastSeenAt ? measuredAt : lastSeenAt;
};

export const deviceLiveness = (lastSeenAt: string | null, now: DateTime): ValueState => {
  if (!lastSeenAt) return 'offline';
  const seconds = (now.toMillis() - DateTime.fromISO(lastSeenAt).toMillis()) / 1000;
  if (seconds <= VALUE_AGE.liveSeconds) return 'live';
  return seconds <= VALUE_AGE.staleSeconds ? 'stale' : 'offline';
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
