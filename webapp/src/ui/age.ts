import { DateTime, Duration } from 'luxon';
import type { MetricValue, ValueState } from '@fg2/shared-types/v1';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas/value-age.js';

/**
 * Every value on a screen carries its age. Whether it is live, stale or offline
 * is the server's answer - it has the clock and the one constant - so nothing
 * here decides that; this only puts the age into words and says how far the
 * value is dimmed.
 */

/** "20 s", "4 min", "2 h", "3 d" - short, so it fits beside the figure it belongs to. */
export const ageLabel = (measuredAt: string | null, now: DateTime = DateTime.now()): string => {
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

export const isStale = (value: Pick<MetricValue, 'state'>): boolean => value.state !== 'live';

/**
 * How alive a device is, from the last thing it said.
 *
 * The server decides the state of a *value* and answers it; a device's own
 * liveness is in no answer, so it is worked out here - against the contract's
 * one constant rather than a second copy of those seconds.
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
