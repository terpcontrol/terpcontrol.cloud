import { api } from './client';

/**
 * A list read to its end rather than to its first page.
 *
 * Every list of the API answers fifty rows and a cursor for the rest, which is
 * what a list somebody scrolls wants. It is the wrong shape for a list a screen
 * looks names up in: a tent that is merely on the second page is not a tent
 * that is gone, and a screen that cannot tell those two apart prints the wrong
 * one about a link that is still handing somebody's grow out. So the cursor is
 * followed here until the server says there is no more.
 *
 * The answer carries whether it got that far. The cap exists only so that a
 * list nobody expected to be enormous cannot turn into an unbounded run of
 * requests, and a reader that stopped at it has to know that what it did not
 * find may still be there - which is the whole reason for reading this way.
 */

/** The envelope every list of `/v1` answers in. The generator emits one named type per list, so this is the shape they share. */
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The largest page the server serves; asking for more gets this. One read stays one read. */
export const PAGE_LIMIT = 200;

/** At most this many reads for one list, so that a pathological account cannot hold a screen open for ever. */
export const PAGE_CAP = 10;

export interface EveryPage<T> {
  items: T[];
  /** True when the cursor ran out rather than the cap: only then does "not among these" mean "not there". */
  complete: boolean;
}

export const readEvery = async <T>(
  path: string,
  signal: AbortSignal | undefined,
  query: Record<string, string | number | boolean | null | undefined> = {},
): Promise<EveryPage<T>> => {
  const items: T[] = [];
  let cursor: string | null = null;

  for (let read = 0; read < PAGE_CAP; read += 1) {
    const page: Page<T> = await api.get<Page<T>>(path, { ...query, limit: PAGE_LIMIT, cursor }, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return { items, complete: true };
  }

  return { items, complete: false };
};
