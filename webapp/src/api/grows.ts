import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GrowListItem, GrowReport, GrowWeekCardPage, PlantPage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The grow page's four reads. The grow itself carries its summary - the day
 * counter, the phase, the "auto" tag - worked out by the server, so nothing
 * here counts days. The weeks are paged, newest first, because every card costs
 * the server a time-series read; the page asks for the next screenful only when
 * somebody scrolls to it.
 *
 * The first two are the Log sheet's as well, where there may be no grow at all:
 * a sheet pointed at a tent asks for nothing rather than for a grow called null.
 */

export const useGrow = (growId: string | null) =>
  useQuery({
    queryKey: ['grow', growId],
    queryFn: ({ signal }) => api.get<GrowListItem>(`/grows/${growId}`, undefined, signal),
    enabled: growId !== null,
  });

export const useGrowPlants = (growId: string | null) =>
  useQuery({
    queryKey: ['grow', growId, 'plants'],
    queryFn: ({ signal }) => api.get<PlantPage>(`/grows/${growId}/plants`, undefined, signal),
    enabled: growId !== null,
  });

export const useGrowWeeks = (growId: string) =>
  useInfiniteQuery({
    queryKey: ['grow', growId, 'weeks'],
    queryFn: ({ pageParam, signal }) => api.get<GrowWeekCardPage>(`/grows/${growId}/weeks`, { cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

export const useGrowReport = (growId: string) =>
  useQuery({
    queryKey: ['grow', growId, 'report'],
    queryFn: ({ signal }) => api.get<GrowReport>(`/grows/${growId}/report`, undefined, signal),
  });
