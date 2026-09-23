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

/** "20 s", "4 min", "2 h", "3 d" - short, so it fits beside the figure it belongs to. */
export const ageLabel = (measuredAt: string | null, now: DateTime = serverNow()): string => {
  if (!measuredAt) return '—';
  const elapsed = Duration.fromMillis(Math.max(0, now.toMillis() - DateTime.fromISO(measuredAt).toMillis()));
  const seconds = Math.floor(elapsed.as('seconds'));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
};

/**
 * The same words for a span somebody hands us in seconds rather than as an
 * instant - how long a device has been quiet, how long an output has run - so
 * that "3 d" means the same thing wherever it is read.
 */
export const spanLabel = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole} s`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min`;
  if (whole < 86_400) return `${Math.floor(whole / 3600)} h`;
  return `${Math.floor(whole / 86_400)} d`;
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
export const deviceLiveness = (lastSeenAt: string | null, now: DateTime): ValueState => {
  if (!lastSeenAt) return 'offline';
  const seconds = (now.toMillis() - DateTime.fromISO(lastSeenAt).toMillis()) / 1000;
  if (seconds <= VALUE_AGE.liveSeconds) return 'live';
  return seconds <= VALUE_AGE.staleSeconds ? 'stale' : 'offline';
};

/** How much of a hold is left, in the same words an age is put in. */
export const leftLabel = (until: string, now: DateTime): string => ageLabel(now.toISO(), DateTime.fromISO(until));

/**
 * An instant as the contract carries one: ISO 8601 in UTC, whatever zone the
 * reader is in. A local offset is a different string for the same moment, and
 * the server takes only this one.
 */
export const instantOf = (at: DateTime): string => at.toUTC().toISO()!;

/** Whether an instant is still to come: a silence, a mute or a link that has not run out yet. */
export const isAhead = (instant: string | null, now: DateTime): boolean => instant !== null && DateTime.fromISO(instant) > now;
