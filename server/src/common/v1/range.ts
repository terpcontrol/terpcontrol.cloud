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

/**
 * Whether one instant falls outside the window, both ends counting as inside -
 * exactly as `withinRange` filters the list the row would have come out of.
 *
 * A grant reaches a grow, not each of the rows hanging off it, so a route that
 * answers one row by its id has to ask this for itself. Without it a link that
 * was sent one fortnight hands out everything else one id at a time, and an id
 * is guessable enough to try.
 */
export const outsideRange = (at: Date, range: AccessRange): boolean =>
  (range.startsAt !== null && at < range.startsAt) || (range.endsAt !== null && at > range.endsAt);

/** A stretch of time with both ends named, which is what a span narrowed to a window always has. */
export interface Span {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The part of a stretch of time a reader may see: the stretch itself, narrowed
 * to the window the grant carries.
 *
 * The window belongs to the link and not to what is being read, and a week is
 * seven days and a flowering phase is eleven weeks whatever the link says. So
 * everything summarised, counted or pictured over such a stretch is read over
 * this instead - otherwise a link that opens on a Wednesday hands out the Sunday
 * before it, and a link onto one day of a phase states the coldest night and the
 * wettest hour of the eighty days around it.
 */
export const seenOf = (span: Span, range: AccessRange): Span => ({
  startsAt: range.startsAt && range.startsAt > span.startsAt ? range.startsAt : span.startsAt,
  endsAt: range.endsAt && range.endsAt < span.endsAt ? range.endsAt : span.endsAt,
});

/**
 * The last instant a reader's story runs to: now, or the moment their window
 * closed, whichever came first.
 *
 * Everything stated about a thing as a whole - the day a grow is on, the stage
 * it is in, whether it is over, how long it lasted - is worked out against this
 * rather than against the clock, because a link whose window closed in August
 * was not sent September.
 */
export const storyEndsAt = (range: AccessRange, now: Date): Date => (range.endsAt !== null && range.endsAt < now ? range.endsAt : now);
