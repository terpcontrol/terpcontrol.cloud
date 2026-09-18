import { badRequest } from './problem';

/**
 * Every list of `/v1` answers `{ items, nextCursor }` and is continued with the
 * cursor it handed out. A cursor is not an offset: a page is continued from the
 * last row it contained, so rows written meanwhile neither shift a page nor make
 * one skip - which for a diary, where the newest row arrives while somebody is
 * reading, is the difference between a timeline and a shuffle.
 *
 * The cursor is the sort key of that last row, which for every list here is an
 * instant and, where two rows share it, the id. It is opaque on the wire and a
 * client only ever hands it back.
 */

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE_LIMIT = 50;

/** A page a client asks to be bigger than this gets this. One read stays one read. */
export const MAX_PAGE_LIMIT = 200;

export const pageLimit = (limit?: number | null): number => {
  if (!limit || limit < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.trunc(limit), MAX_PAGE_LIMIT);
};

/** Where a row sits in its list: the instant it is sorted by, and its id where two share one. */
export interface PagePosition {
  at: Date;
  id: string;
}

export const encodeCursor = (position: PagePosition): string =>
  Buffer.from(`${position.at.toISOString()}|${position.id}`, 'utf8').toString('base64url');

export const decodeCursor = (cursor: string): PagePosition => {
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = rest.join('|');
  const instant = new Date(at);

  if (!id || Number.isNaN(instant.getTime())) {
    throw badRequest('invalid_cursor', 'The cursor does not come from a page of this list.', [
      { field: 'cursor', code: 'invalid', detail: 'Hand back a `nextCursor` a page answered with.' },
    ]);
  }

  return { at: instant, id };
};

/**
 * The filter that continues a list after `cursor`, for a collection sorted by
 * `field` and then by `id`. Both halves are needed: rows that share an instant
 * would otherwise be handed out twice or not at all, and a diary written by a
 * device puts several rows on the same second regularly.
 */
export const afterCursor = (field: string, cursor: string | null | undefined, order: 'asc' | 'desc' = 'desc'): Record<string, unknown> => {
  if (!cursor) return {};

  const { at, id } = decodeCursor(cursor);
  const beyond = order === 'desc' ? '$lt' : '$gt';

  return { $or: [{ [field]: { [beyond]: at } }, { [field]: at, id: { [beyond]: id } }] };
};

/** Read one row more than the page holds: whether it came back is what says there is a next page. */
export const readLimit = (limit: number): number => limit + 1;

/**
 * The page itself, from the rows `readLimit` asked for. The extra row is dropped
 * rather than answered, and the cursor names the last row that is kept.
 */
export const pageOf = <T>(rows: T[], limit: number, positionOf: (row: T) => PagePosition): CursorPage<T> => {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > items.length;

  return { items, nextCursor: hasMore && items.length > 0 ? encodeCursor(positionOf(items[items.length - 1])) : null };
};
