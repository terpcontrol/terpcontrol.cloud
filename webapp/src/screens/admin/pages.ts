import { useEffect } from 'react';

/**
 * Reading a whole admin list rather than its first page.
 *
 * The fleet table and the account list are counted, not browsed: an operator
 * asking how many devices are behind a build is asking about all of them, and a
 * table showing the first two hundred of six hundred would answer a question
 * nobody asked. So the cursor is followed as far as the cap, which exists only
 * so that a list nobody expected to be enormous cannot turn into an unbounded
 * run of requests; past it the screen says what it is showing and offers the
 * rest by hand.
 */
export const PAGE_CAP = 10;

interface Followable {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  data?: { pages: unknown[] };
}

export const useFollowCursor = (query: Followable) => {
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const read = query.data?.pages.length ?? 0;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && read > 0 && read < PAGE_CAP) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, read, fetchNextPage]);
};
