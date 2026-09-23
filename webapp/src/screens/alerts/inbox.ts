import { DateTime } from 'luxon';
import type { AlarmRule, Alert, Me, OutputLevelWatch, ReadingWatch, Severity } from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { routedChannels } from '@/screens/control/alarms/rules';
import { ageLabel, instantOf } from '@/ui/age';
import { zoned } from '@/ui/zone';

/**
 * How the inbox is cut up, which bound a reading crossed, and whether anybody
 * was told. All of it is plain arithmetic on the server's instants and on the
 * account's own grid, kept out of the card so it can be checked without drawing
 * anything.
 */

export type GroupHeading = { kind: 'now' } | { kind: 'earlierToday' } | { kind: 'yesterday' } | { kind: 'day'; day: DateTime };

export interface AlertGroup {
  key: string;
  heading: GroupHeading;
  alerts: Alert[];
}

const startedMillis = (alert: Alert) => DateTime.fromISO(alert.startedAt).toMillis();

/** How bad first, because what is open is read from the top and a phone shows three cards of it. */
const WORST_FIRST: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Everything still open comes first, whatever day it began on: it is what is
 * wrong now. Inside that group the worst comes first and the clock decides only
 * between equals - a second critical tent below three warnings is off the
 * bottom of a phone, and the order a thing happened in is no help to somebody
 * deciding what to deal with. What has resolved is a record rather than a queue
 * and stays in the order it happened: filed under the day it started on in the
 * account's own zone, today and yesterday by name and every earlier day by its
 * date, newest first inside each. Nothing is left out for being old.
 */
export const groupsOf = (alerts: Alert[], now: DateTime, zone: string | null): AlertGroup[] => {
  const newestFirst = [...alerts].sort((a, b) => startedMillis(b) - startedMillis(a));
  const open = newestFirst
    .filter(alert => alert.resolvedAt === null)
    .sort((a, b) => WORST_FIRST[a.severity] - WORST_FIRST[b.severity] || startedMillis(b) - startedMillis(a));
  const groups: AlertGroup[] = open.length ? [{ key: 'now', heading: { kind: 'now' }, alerts: open }] : [];

  const here = zone ? now.setZone(zone) : now;
  const today = here.startOf('day').toISODate();
  const yesterday = here.startOf('day').minus({ days: 1 }).toISODate();
  const days = new Map<string, AlertGroup>();
  for (const alert of newestFirst) {
    if (alert.resolvedAt === null) continue;
    const day = zoned(alert.startedAt, zone).startOf('day');
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

/** How long an alert has stood: until now while it is open, until it resolved once it has. */
export const lastedLabel = (alert: Alert, now: DateTime): string =>
  ageLabel(alert.startedAt, alert.resolvedAt ? DateTime.fromISO(alert.resolvedAt) : now);

/** The hour an instant fell on, in the zone the account keeps - the one the server holds its alarms back by. */
export const clock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat('HH:mm');

/** What the card says will happen about this alert, as the key it is said in. */
export type Delivery = 'notAnnounced' | 'unheard' | 'once' | 'repeats';

/**
 * Whether anybody was told, and how often they will be told again.
 *
 * The question is asked of the alert's own severity rather than the rule's,
 * because that is the grade the server announced it at and the grade the card
 * says out loud; a card that took the word from one and the promise from the
 * other told a person their info alarm had been announced. An alarm in neither
 * row of the grid - which is what `info` is - is announced nowhere, and one
 * routed to channels the account has not configured is announced to nobody,
 * which the alarm rules page says of the rule in its own words. A rule that
 * addresses itself carries its target with it and goes out whatever the grid
 * says. Until the account has answered, nothing is known either way and nothing
 * is claimed.
 */
export const deliveryOf = (alert: Alert, rule: AlarmRule, me: Me | undefined): Delivery | null => {
  if (!me) return null;

  if (rule.delivery.mode === 'routing') {
    if (alertCategory(alert.severity) === null) return 'notAnnounced';
    if (!routedChannels(me, alert.severity).some(routed => routed.configured)) return 'unheard';
  }

  return rule.repeatSeconds > 0 ? 'repeats' : 'once';
};
