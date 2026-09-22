import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AlertPage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * What has gone wrong, for the inbox behind the bell and the count on it.
 *
 * An alert is opened and closed by the alarm engine on the device's own
 * samples, so the list is read on the beat live values age on; a refresh that
 * fails keeps the last answer, and every card carries the instant it started.
 */

export const ALERTS_REFRESH_MS = 30_000;

/** More than a beginner's inbox holds in a season, and the page the cursor is followed from. */
const ALERTS_LIMIT = 100;

/** The largest number the bell draws. Beyond it the badge says so rather than counting a page that is not the whole of it. */
export const MANY_OPEN = 99;

export const alertsKey = (open: boolean | null) => ['alerts', open === null ? 'all' : open ? 'open' : 'closed'];

/**
 * Every alert this account can see, newest first, a page at a time.
 *
 * The first page is what the inbox draws; the cursor is followed only when the
 * reader asks for what came before, and each page already read is refreshed on
 * the beat with it, because an old page can resolve while it is on screen.
 */
export const useAlerts = (open: boolean | null = null) =>
  useInfiniteQuery({
    queryKey: alertsKey(open),
    queryFn: ({ pageParam, signal }) =>
      api.get<AlertPage>('/alerts', { open: open === null ? undefined : open, limit: ALERTS_LIMIT, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    refetchInterval: ALERTS_REFRESH_MS,
  });

/** What the bell knows: how many alerts the open page carries, and whether another page stands behind it. */
export interface OpenAlerts {
  open: number;
  more: boolean;
}

export const useOpenAlertCount = (enabled = true) =>
  useQuery({
    queryKey: alertsKey(true),
    queryFn: ({ signal }) => api.get<AlertPage>('/alerts', { open: true, limit: ALERTS_LIMIT }, signal),
    refetchInterval: ALERTS_REFRESH_MS,
    enabled,
    select: (page): OpenAlerts => ({ open: page.items.length, more: page.nextCursor !== null }),
  });

/**
 * What the bell draws and what it says it is, or nothing at all while no alert
 * is open, so a quiet account reads as quiet rather than as a zero. A count
 * taken from one page would understate an account with more than fits on it,
 * so that one says "99+" and means it.
 */
export const bellOf = (alerts: OpenAlerts | undefined): { text: string; key: string; count: number } | null => {
  if (!alerts || alerts.open === 0) return null;
  return alerts.more
    ? { text: `${MANY_OPEN}+`, key: 'alerts.bellMore', count: MANY_OPEN }
    : { text: String(alerts.open), key: 'alerts.bell', count: alerts.open };
};
