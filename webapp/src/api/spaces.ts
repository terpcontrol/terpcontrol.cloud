import { useQuery } from '@tanstack/react-query';
import type { SpaceLive, SpaceOverview, SpacePage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The tent page reads its overview once a minute and its live values every
 * half minute: the overview costs a day of series for the verdict, the live
 * read costs one `last()`, and it is the values that age. A refresh that fails
 * leaves the last answer in place with its ages, which is what the ages are for.
 */
export const OVERVIEW_REFRESH_MS = 60_000;
export const LIVE_REFRESH_MS = 30_000;

export const useSpaces = () =>
  useQuery({
    queryKey: ['spaces'],
    queryFn: ({ signal }) => api.get<SpacePage>('/spaces', undefined, signal),
  });

export const useSpaceOverview = (spaceId: string) =>
  useQuery({
    queryKey: ['space', spaceId, 'overview'],
    queryFn: ({ signal }) => api.get<SpaceOverview>(`/spaces/${spaceId}/overview`, undefined, signal),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });

export const useSpaceLive = (spaceId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['space', spaceId, 'live'],
    queryFn: ({ signal }) => api.get<SpaceLive>(`/spaces/${spaceId}/live`, undefined, signal),
    refetchInterval: LIVE_REFRESH_MS,
    enabled,
  });
