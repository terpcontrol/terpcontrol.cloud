import { DateTime } from 'luxon';
import type { Alert, OutputLevelWatch, ReadingWatch } from '@fg2/shared-types/v1';
import { ageLabel, instantOf } from '@/ui/age';

/**
 * How the inbox is cut up, and which bound a reading crossed. Both are plain
 * arithmetic on the server's instants, kept out of the card so they can be
 * checked without drawing anything.
 */

export type GroupHeading = { kind: 'now' } | { kind: 'earlierToday' } | { kind: 'yesterday' } | { kind: 'day'; day: DateTime };

export interface AlertGroup {
  key: string;
  heading: GroupHeading;
  alerts: Alert[];
}

const startedMillis = (alert: Alert) => DateTime.fromISO(alert.startedAt).toMillis();

/**
 * Everything still open comes first, whatever day it began on: it is what is
 * wrong now. What has resolved is filed under the local day it started, today
 * and yesterday by name and every earlier day by its date, newest first inside
 * each. Nothing is left out for being old.
 */
export const groupsOf = (alerts: Alert[], now: DateTime): AlertGroup[] => {
  const newestFirst = [...alerts].sort((a, b) => startedMillis(b) - startedMillis(a));
  const open = newestFirst.filter(alert => alert.resolvedAt === null);
  const groups: AlertGroup[] = open.length ? [{ key: 'now', heading: { kind: 'now' }, alerts: open }] : [];

  const today = now.startOf('day').toISODate();
  const yesterday = now.startOf('day').minus({ days: 1 }).toISODate();
  const days = new Map<string, AlertGroup>();
  for (const alert of newestFirst) {
    if (alert.resolvedAt === null) continue;
    const day = DateTime.fromISO(alert.startedAt).startOf('day');
    const key = day.toISODate()!;
    let group = days.get(key);
    if (!group) {
      const heading: GroupHeading = key === today ? { kind: 'earlierToday' } : key === yesterday ? { kind: 'yesterday' } : { kind: 'day', day };
      group = { key, heading, alerts: [] };
      days.set(key, group);
    }
    group.alerts.push(alert);
  }

  return [...groups, ...days.values()];
};

/**
 * The bound the reading went past, so the card can say "68 % › 60" rather than
 * both edges. A reading below the lower edge names that edge; anything else
 * names the upper one where there is one, because a rule with both edges is
 * nearly always tripped from above. Without a reading the rule's first edge
 * stands in.
 */
export const crossedBound = (
  { upper, lower }: Pick<ReadingWatch | OutputLevelWatch, 'upper' | 'lower'>,
  value: number | null,
): { over: boolean; bound: number } | null => {
  if (value !== null && lower !== null && value < lower) return { over: false, bound: lower };
  if (upper !== null) return { over: true, bound: upper };
  if (lower !== null) return { over: false, bound: lower };
  return null;
};

/** A length of time in the words an age is put in: "20 s", "4 min", "2 h", "3 d". */
export const spanLabel = (seconds: number, now: DateTime): string => ageLabel(instantOf(now.minus({ seconds })), now);

/** How long an alert has stood: until now while it is open, until it resolved once it has. */
export const lastedLabel = (alert: Alert, now: DateTime): string =>
  ageLabel(alert.startedAt, alert.resolvedAt ? DateTime.fromISO(alert.resolvedAt) : now);

/** The hour an instant fell on, in the reader's own zone. */
export const clock = (instant: string): string => DateTime.fromISO(instant).toFormat('HH:mm');
