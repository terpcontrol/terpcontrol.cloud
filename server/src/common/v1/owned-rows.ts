import { FilterQuery, Model } from 'mongoose';
import { AccessContext } from './access.types';
import { ProblemException } from './problem';

/**
 * Rows that are a page in somebody's own notebook - a saved chart, a feeding
 * scheme. They stand in no space and belong to no grow, so `access()` cannot be
 * asked about one: whose it is, is the whole of it.
 *
 * The rows a caller may see at all, as one filter rather than a decision per
 * row, or null where that is none: a demo session is a tour and not an account,
 * so it owns nothing. Not even an administrator is widened here. This is the
 * filter a listing is held to, and the listing is the person's own page;
 * answering it install-wide would have put strangers' rows on it.
 */
export const ownRows = (ctx: AccessContext): { ownerId: string } | null => (ctx.isDemo || ctx.userId === null ? null : { ownerId: ctx.userId });

/**
 * One row named by id, as its owner. Somebody else's is answered as missing
 * rather than as refused, because a refusal that named one would report that it
 * exists to a person with no way of knowing that otherwise.
 *
 * Here, and not in the filter above, is where an administrator is widened:
 * asking for one named row is the office acting deliberately on a row somebody
 * has pointed at, which is the same distinction `access()` draws between
 * deciding one subject and answering a list.
 */
export const requireOwned = async <T>(model: Model<T>, ctx: AccessContext, id: string, missing: () => ProblemException): Promise<T> => {
  const own = ctx.isAdmin ? {} : ownRows(ctx);
  const row =
    own &&
    (await model
      .findOne({ $and: [{ id }, own] } as FilterQuery<T>)
      .lean<T>()
      .exec());
  if (!row) throw missing();

  return row;
};
