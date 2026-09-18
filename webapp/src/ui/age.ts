import { DateTime, Duration } from 'luxon';
import type { MetricValue, ValueState } from '@fg2/shared-types/v1';

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
 * What `global.css` dims by. It is an attribute rather than a class so a row can
 * pass it straight through to whatever it wraps.
 */
export const ageAttribute = (state: ValueState): { 'data-age': ValueState } => ({ 'data-age': state });

export const isStale = (value: Pick<MetricValue, 'state'>): boolean => value.state !== 'live';
