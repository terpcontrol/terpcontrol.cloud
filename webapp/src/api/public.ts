import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GrowWeekCard, PublicGrowPage, PublicUserPage, PublicWeekPage, SharedResolution } from '@fg2/shared-types/v1';
import { api } from './client';
import { v1 } from './config';

/**
 * What can be read with no account at all: a diary at its own address, the
 * person who keeps it, and whatever a link somebody was handed leads to.
 *
 * They go through the same fetch wrapper as every other read, which attaches a
 * bearer token only when a session happens to have one - a stranger's request
 * carries nothing, and the owner's carries their session without changing a
 * word of the answer, because what may be seen is decided from the address.
 *
 * Nothing here refetches on a beat. A public page is read from top to bottom
 * once; the week cards behind it cost the server a time-series read each, and
 * a reader who wants it again reloads it.
 */

/**
 * How a page addresses a picture. Every picture on a public page goes through
 * one of these two, so a component that draws a thumbnail never knows which of
 * the two addresses it is on.
 */
export type Picture = (mediaId: string, width?: number) => string;

export const usePublicGrow = (slug: string) =>
  useQuery({
    queryKey: ['public', 'grow', slug],
    queryFn: ({ signal }) => api.get<PublicGrowPage>(`/public/grows/${encodeURIComponent(slug)}`, undefined, signal),
  });

export const usePublicUser = (handle: string) =>
  useQuery({
    queryKey: ['public', 'user', handle],
    queryFn: ({ signal }) => api.get<PublicUserPage>(`/public/users/${encodeURIComponent(handle)}`, undefined, signal),
  });

/** What a diary draws under its own weeks: the earlier ones, the way to ask for more, and whether more are on their way. */
export interface EarlierWeeks {
  weeks: GrowWeekCard[];
  /** Null once there is nothing earlier to ask for, which is what takes the control off the page. */
  more: (() => void) | null;
  pending: boolean;
}

/**
 * The weeks of a diary from before the ones its page carried, a page at a time.
 *
 * A long grow's page opens on its newest weeks and says with a cursor that
 * there are earlier ones; this is what the control under them follows. Nothing
 * is asked for until somebody asks - the query is disabled and `fetchNextPage`
 * is the whole of it - so a reader who stops at the newest week costs the
 * server one page of week reads, which is what the cursor is there for.
 *
 * Where the next page begins is worked out here rather than read from
 * `hasNextPage`: before anything has been fetched there are no pages to derive
 * it from, and the cursor the diary itself carried is what says whether there
 * is anything earlier at all.
 */
const useEarlierWeeks = (queryKey: unknown[], path: string, from: string | null): EarlierWeeks => {
  const query = useInfiniteQuery({
    queryKey: [...queryKey, 'weeks', from],
    queryFn: ({ pageParam, signal }) => api.get<PublicWeekPage>(path, { cursor: pageParam }, signal),
    initialPageParam: from,
    getNextPageParam: last => last.nextCursor,
    enabled: false,
  });

  const pages = query.data?.pages ?? [];
  const next = pages.length === 0 ? from : pages[pages.length - 1].nextCursor;

  return {
    weeks: pages.flatMap(page => page.items),
    more: next === null ? null : () => void query.fetchNextPage(),
    pending: query.isFetching,
  };
};

export const usePublicGrowWeeks = (slug: string, from: string | null) =>
  useEarlierWeeks(['public', 'grow', slug], `/public/grows/${encodeURIComponent(slug)}/weeks`, from);

export const useSharedWeeks = (token: string, from: string | null) =>
  useEarlierWeeks(['shared', token], `/shared/${encodeURIComponent(token)}/weeks`, from);

/**
 * A link, resolved. A token that was revoked, has expired or never existed is
 * the same 404 in all three cases, on purpose, so the screen behind this can
 * say only that the address leads nowhere.
 */
export const useSharedLink = (token: string) =>
  useQuery({
    queryKey: ['shared', token],
    queryFn: ({ signal }) => api.get<SharedResolution>(`/shared/${encodeURIComponent(token)}`, undefined, signal),
  });

const withWidth = (url: string, width: number | undefined, separator: string): string => (width ? `${url}${separator}width=${width}` : url);

/**
 * A picture of a public grow. There is no token of any kind: which pictures are
 * part of that diary is the route's own decision, and the grow's address is the
 * whole of the request.
 */
export const publicPicture =
  (slug: string): Picture =>
  (mediaId, width) =>
    withWidth(v1(`/public/grows/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}`), width, '?');

/**
 * A picture read through a link. The token rides in the query string for the
 * same reason the media token always has: an `<img>` cannot carry a header, and
 * the token is the reader's only proof.
 */
export const sharedPicture =
  (token: string): Picture =>
  (mediaId, width) =>
    withWidth(`${v1(`/media/${encodeURIComponent(mediaId)}/content`)}?share=${encodeURIComponent(token)}`, width, '&');

/** The widths the public page asks its pictures for: twice what they are drawn at, for a phone's screen. */
export const PUBLIC_WIDTH = { avatar: 96, dayTile: 200, card: 480, cover: 1200 } as const;
