import { MetricValue, ValueState } from '@fg2/shared-types/v1';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas';

/**
 * How old a value is, decided in one place from the shared constant and the
 * server's clock. Every answer carries the verdict rather than the arithmetic,
 * so no other module here works it out again, and nothing a client sends back
 * is a state. A screen does re-read the constant to age a value it is still
 * drawing after this answer has gone stale in its hands - that is the same
 * seconds applied to the same instant, not a second verdict - and a value is
 * dimmed by its state, never hidden, which is why the instant stays in the
 * answer when the device has been quiet for days.
 *
 * A value from the future is `live`: a device's clock running ahead is not a
 * reason to call the reading it just sent stale.
 */
export const valueStateAt = (measuredAt: Date | null, now: Date = new Date()): ValueState => {
  if (!measuredAt) return 'offline';

  const seconds = (now.getTime() - measuredAt.getTime()) / 1000;
  if (seconds < VALUE_AGE.liveSeconds) return 'live';

  return seconds < VALUE_AGE.staleSeconds ? 'stale' : 'offline';
};

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

/**
 * When a device was really last heard, from everything the cloud holds that
 * proves it.
 *
 * `lastSeenAt` is the cloud's own note of the last message it took, and the
 * ingest stamps it on every one, so on a device claimed into this cloud the
 * note and the readings can never part. The devices carried over from the old
 * cloud were given the last *connection* that cloud recorded, and that fleet
 * went on writing samples for another half day afterwards - so for them the
 * note is simply older than the truth, and a silence counted from it is longer
 * than the one the stored readings show.
 *
 * A stored reading is proof the device was heard, so the later of the two is
 * the answer. It can only shorten a silence and never invent one: no device is
 * made to look present by a reading older than the last message from it. The
 * webapp dates a device row by this same rule, and stating it here is what
 * keeps the sentence an alarm writes from contradicting the chart beside it.
 */
export const heardAt = (lastSeenAt: Date | null, sampleAt: Date | null): Date | null => {
  if (!lastSeenAt) return sampleAt;
  if (!sampleAt) return lastSeenAt;

  return sampleAt.getTime() > lastSeenAt.getTime() ? sampleAt : lastSeenAt;
};
