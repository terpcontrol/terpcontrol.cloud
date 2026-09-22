import { useInfiniteQuery } from '@tanstack/react-query';
import type { AlertPage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * What has gone wrong, for the inbox behind the bell and the count on it.
 *
 * An alert is opened and closed by the alarm engine on the device's own
 * samples, so the list is read on the beat live values age on; a refresh that
 * fails keeps the last answer, and every card carries the instant it started.
 *
 * What is open and what is over are two reads rather than one, because they are
 * two different questions and only one of them is the bell's. The count on the
 * bell is the open list itself, so the shell and the inbox's first group are one
 * query however many screens draw a bell - a badge that re-read the whole page
 * beside the page was the same alerts fetched twice a beat.
 */

export const ALERTS_REFRESH_MS = 30_000;

/** More than a beginner's inbox holds in a season, and the page the cursor is followed from. */
const ALERTS_LIMIT = 100;

/** The largest number the bell draws. Beyond it the badge says so rather than counting a page that is not the whole of it. */
export const MANY_OPEN = 99;

export const alertsKey = (open: boolean) => ['alerts', open ? 'open' : 'closed'];

const useAlerts = (open: boolean) =>
  useInfiniteQuery({
    queryKey: alertsKey(open),
    queryFn: ({ pageParam, signal }) => api.get<AlertPage>('/alerts', { open, limit: ALERTS_LIMIT, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    refetchInterval: ALERTS_REFRESH_MS,
  });

/** Everything still wrong, newest first: the inbox's first group, and the number on the bell. */
export const useOpenAlerts = () => useAlerts(true);

/**
 * The episodes that are over, newest first, a page at a time. The first page is
 * what the inbox draws under the days; the cursor is followed only when the
 * reader asks for what came before, and each page already read is refreshed
 * with it so a card cannot go stale while it is on screen.
 */
export const useResolvedAlerts = () => useAlerts(false);

/** What the bell knows: how many alerts are open, and whether another page stands behind them. */
export interface OpenAlerts {
  open: number;
  more: boolean;
}

export const useOpenAlertCount = (): OpenAlerts | undefined => {
  const open = useOpenAlerts();
  if (!open.data) return undefined;

  return { open: open.data.pages.reduce((count, page) => count + page.items.length, 0), more: open.hasNextPage };
};

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
