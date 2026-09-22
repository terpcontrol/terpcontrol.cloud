import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { GrowSeries, GrowSeriesRange, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * Everything the Charts view draws, in one read.
 *
 * The screen asks for every line it could draw rather than for the ones that
 * are ticked, and that is deliberate. What a chip bar may offer is exactly what
 * the account has: a metric no controller reported has no panel in the answer,
 * a measurement nobody has taken has no series, and an output nothing drives
 * has no lane. Asking only for the ticked lines would leave the screen guessing
 * at the rest, and a chip offered for a line that turns out to be empty is a
 * tap that leads nowhere. The server reads its store once per device whatever
 * the list says, so naming every metric costs a wider projection and not a
 * second read.
 *
 * The window is the whole question, so a chip is a change of window and not of
 * screen: the answer in hand stays drawn until the next one arrives, as on the
 * Timeline tab. That holds when the next one never arrives at all - a server
 * that cannot answer the window just asked for has not made the window already
 * on the screen untrue - so the last answer that did arrive is handed back
 * beside the query, read out of the cache rather than kept by the screen, which
 * is where it belongs: it is about this grow and not about what is drawn of it.
 */

/** The climate a chart can draw. The other metrics of the contract are states and offsets rather than curves. */
export const CHART_METRICS: Metric[] = ['temperature', 'humidity', 'vpd', 'co2'];

/** In the order the board puts them: what a grower steers first stands first, and the rest live behind "+ more". */
export const CHART_OUTPUTS: OutputMetric[] = ['light', 'dehumidifier', 'heater', 'co2', 'fan', 'fanInternal', 'fanExternal', 'fanBackwall', 'relais'];

export interface SeriesWindow {
  range: GrowSeriesRange;
  /** Both ends of a `custom` range, as a date field speaks them; the server refuses one without the other. */
  from?: string;
  to?: string;
  /** The keys of the grow's own measurements worth asking about, which is the ones it charts. */
  measurements: string[];
}

/** A custom range is the one window the chips cannot name, so it is the one that can be asked for incomplete. */
const askable = (window: SeriesWindow): boolean => window.range !== 'custom' || (!!window.from && !!window.to);

export const useGrowSeries = (growId: string | null, window: SeriesWindow) => {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['grow', growId, 'series', window],
    queryFn: ({ signal }) => api.get<GrowSeries>(`/grows/${growId}/series?${queryOf(window)}`, undefined, signal),
    enabled: growId !== null && askable(window),
    placeholderData: keepPreviousData,
  });

  return { ...query, held: query.data ? null : lastOf(client, growId) };
};

/** The freshest answer about this grow that really arrived, whichever window asked for it, and when it did. */
const lastOf = (client: QueryClient, growId: string | null): { data: GrowSeries; at: number } | null => {
  if (growId === null) return null;

  return client
    .getQueryCache()
    .findAll({ queryKey: ['grow', growId, 'series'] })
    .reduce<{ data: GrowSeries; at: number } | null>((found, one) => {
      const state = one.state as { data?: GrowSeries; dataUpdatedAt: number };

      return state.data && (!found || state.dataUpdatedAt > found.at) ? { data: state.data, at: state.dataUpdatedAt } : found;
    }, null);
};

/**
 * The route reads a list as the same name repeated, which a flat record of
 * parameters cannot say - so this one call writes its own query string rather
 * than handing the shared client a record it would collapse to one value each.
 */
const queryOf = (window: SeriesWindow): string => {
  const parameters = new URLSearchParams({ range: window.range });
  if (window.from && window.to) {
    parameters.set('from', window.from);
    parameters.set('to', window.to);
  }
  for (const metric of CHART_METRICS) parameters.append('metrics', metric);
  for (const output of CHART_OUTPUTS) parameters.append('outputs', output);
  for (const key of window.measurements) parameters.append('measurements', key);

  return parameters.toString();
};
