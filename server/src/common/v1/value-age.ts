import { MetricValue, ValueState } from '@fg2/shared-types/v1';
import { VALUE_AGE, valueStateOfAge } from '@fg2/shared-types/v1-schemas';

/**
 * How old a value is, decided in one place from the shared rule and the
 * server's clock. Every answer carries the verdict rather than the arithmetic,
 * so no other module here works it out again, and nothing a client sends back
 * is a state. A screen does re-read the rule to age a value it is still drawing
 * after this answer has gone stale in its hands - that is the same seconds
 * applied to the same instant, not a second verdict - and a value is dimmed by
 * its state, never hidden, which is why the instant stays in the answer when
 * the device has been quiet for days.
 */
export const valueStateAt = (measuredAt: Date | null, now: Date = new Date()): ValueState =>
  measuredAt ? valueStateOfAge((now.getTime() - measuredAt.getTime()) / 1000) : 'offline';

/** A reading as every card and every `/live` answer carries it. */
export const metricValueOf = (value: number | null, measuredAt: Date | null, now: Date = new Date()): MetricValue => ({
  value,
  measuredAt: measuredAt?.toISOString() ?? null,
  state: valueStateAt(measuredAt, now),
});

/**
 * Whether a device counts as gone. It is the same threshold a value's state is
 * decided by, which is what keeps the `offline` metric and a dimmed card saying
 * the same thing about the same device.
 */
export const isOffline = (lastSeenAt: Date | null, now: Date = new Date()): boolean => valueStateAt(lastSeenAt, now) === 'offline';

/**
 * The same threshold as a query: a device heard from since this instant counts
 * as there. Counting a fleet one device at a time is what this avoids.
 */
export const onlineSince = (now: Date = new Date()): Date => new Date(now.getTime() - VALUE_AGE.staleSeconds * 1000);
