/**
 * How long a device's raw climate is kept, and where that number comes from.
 *
 * Three places can say it and they are read narrowest first: the space the
 * device stands in, then the account that owns it, then the install's own
 * setting. The space wins because that is the direction the record and the
 * screens both point in - the privacy screen sets a window for the person and
 * says underneath it that team mode "adds attribution and longer retention per
 * tent, never per person", which only means anything if the tent's figure is
 * the one that decides. A shared tent is also the case where the account
 * setting is least likely to be the right answer: several people log in it,
 * one of them owns it, and it is the tent that is kept, not the owner.
 *
 * A window of `null` is not "keep nothing" at either level; it is "I have not
 * said", and the next place along answers. The install's own figure may itself
 * be nothing, which is what an install that has never been configured has, and
 * then nothing is ever swept.
 */

/** What a space or an account stores: a number of days, or nothing said. */
export interface Retention {
  climateDays: number | null;
}

/**
 * The window in days, or null where nobody has named one and the raw samples
 * are therefore kept for ever. A figure that is not a positive number is read
 * as nothing said, so a stored zero cannot become "delete everything".
 */
export const climateWindowOf = (space: Retention | null, owner: Retention | null, installDays: number): number | null =>
  positive(space?.climateDays) ?? positive(owner?.climateDays) ?? positive(installDays);

const positive = (days: number | null | undefined): number | null =>
  typeof days === 'number' && Number.isFinite(days) && days > 0 ? Math.trunc(days) : null;

/**
 * The instant a window closes: the start of the UTC day that many days back.
 *
 * It is cut to a whole day because a summary is a whole day. Taking the cutoff
 * at the hour the sweep happened to run would summarise a part of today into a
 * figure called today, and tomorrow's pass would have nothing left to add to
 * it.
 */
export const cutoffOf = (days: number, now: Date): Date => {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return new Date(midnight - days * 24 * 60 * 60 * 1000);
};

/**
 * How much of a device's backlog one pass takes: from the oldest sample's own
 * day up to at most so many days later, and never past the cutoff.
 *
 * A pass is bounded so that the first sweep of an install with years in it is a
 * long series of small pieces of work rather than one query over everything
 * ever written. Nothing remembers where it got to - the next pass asks the
 * store for the oldest sample that is left, which is the same answer whether
 * the last pass finished, was interrupted, or was a week ago.
 */
export const chunkOf = (oldest: Date, cutoff: Date, maxDays: number): { startsAt: Date; endsAt: Date } => {
  const startsAt = new Date(Date.UTC(oldest.getUTCFullYear(), oldest.getUTCMonth(), oldest.getUTCDate()));
  const wanted = startsAt.getTime() + maxDays * 24 * 60 * 60 * 1000;

  return { startsAt, endsAt: new Date(Math.min(wanted, cutoff.getTime())) };
};
