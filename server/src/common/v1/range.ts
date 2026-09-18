import { AccessRange } from './access.types';

/**
 * The window a read happens in.
 *
 * `access()` hands back the window a caller is allowed to see - a share link's
 * range, the life of a public grow - and a request asks for one of its own. Every
 * read takes the narrower of the two, so that asking for a wider window than the
 * link allows answers less rather than more. A null end is open at that end.
 */
export const clampRange = (grant: { range: AccessRange } | undefined, asked: Partial<AccessRange> = {}): AccessRange => ({
  startsAt: latest(grant?.range.startsAt ?? null, asked.startsAt ?? null),
  endsAt: earliest(grant?.range.endsAt ?? null, asked.endsAt ?? null),
});

const latest = (one: Date | null, other: Date | null): Date | null => (one && other ? (one > other ? one : other) : (one ?? other));
const earliest = (one: Date | null, other: Date | null): Date | null => (one && other ? (one < other ? one : other) : (one ?? other));

/**
 * The range as a filter on one instant field. Both ends count as inside, and an
 * open range filters nothing - which is what an owner reading their own diary
 * gets.
 *
 * It is a condition of its own rather than something merged into the rest of a
 * query: a filter is combined with `$and`, never merged, so that two halves that
 * each carry an `$or` cannot replace one another.
 */
export const withinRange = (field: string, range: AccessRange): Record<string, unknown> => {
  const bounds = { ...(range.startsAt ? { $gte: range.startsAt } : {}), ...(range.endsAt ? { $lte: range.endsAt } : {}) };

  return Object.keys(bounds).length > 0 ? { [field]: bounds } : {};
};

/** Whether a span of time reaches into the window at all. Used where the rows are worked out rather than queried. */
export const overlapsRange = (range: AccessRange, startsAt: Date, endsAt: Date): boolean =>
  (range.startsAt === null || endsAt > range.startsAt) && (range.endsAt === null || startsAt < range.endsAt);
