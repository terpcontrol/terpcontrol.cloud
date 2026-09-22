import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ChartView, ChartViewCreate, ChartViewPage, ChartViewUpdate } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The charts somebody saved to come back to.
 *
 * A view holds the question and never the readings: which lines, over which
 * stretch, laid out which way. That is why nothing here is invalidated when a
 * grow changes - a saved view that names a measurement the grow no longer
 * defines draws one line fewer rather than failing, and the screen that draws
 * it is the only place that knows so.
 */

export const chartViewsKey = ['chart-views'];

/** One page is every view this account has, so there is no cursor to follow. */
export const useChartViews = () =>
  useQuery({
    queryKey: chartViewsKey,
    queryFn: ({ signal }) => api.get<ChartViewPage>('/chart-views', { limit: 100 }, signal),
  });

const viewsChanged = (client: QueryClient): void => void client.invalidateQueries({ queryKey: chartViewsKey });

export const useSaveChartView = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: ChartViewCreate) => api.post<ChartView>('/chart-views', body),
    onSuccess: () => viewsChanged(client),
  });
};

export const useRenameChartView = (id: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: ChartViewUpdate) => api.patch<ChartView>(`/chart-views/${id}`, body),
    onSuccess: () => viewsChanged(client),
  });
};

export const useDeleteChartView = (id: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/chart-views/${id}`),
    onSuccess: () => viewsChanged(client),
  });
};
