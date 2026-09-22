import { useQuery } from '@tanstack/react-query';
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

/** More than anybody's inbox holds at once; the cursor is there for the one that does. */
const ALERTS_LIMIT = 100;

export const alertsKey = (open: boolean | null) => ['alerts', open === null ? 'all' : open ? 'open' : 'closed'];

/** Every alert this account can see, newest first; `open` narrows it to what is still standing. */
export const useAlerts = (open: boolean | null = null) =>
  useQuery({
    queryKey: alertsKey(open),
    queryFn: ({ signal }) => api.get<AlertPage>('/alerts', { open: open === null ? undefined : open, limit: ALERTS_LIMIT }, signal),
    refetchInterval: ALERTS_REFRESH_MS,
  });

/** The number on the bell: how many alerts are open right now. */
export const useOpenAlertCount = (enabled = true) =>
  useQuery({
    queryKey: alertsKey(true),
    queryFn: ({ signal }) => api.get<AlertPage>('/alerts', { open: true, limit: ALERTS_LIMIT }, signal),
    refetchInterval: ALERTS_REFRESH_MS,
    enabled,
    select: page => page.items.length,
  });
