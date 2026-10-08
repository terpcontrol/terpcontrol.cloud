import { keepPreviousData, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { GrowSeries, GrowSeriesRange, Metric, OutputMetric, SpaceSeries } from '@fg2/shared-types/v1';
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

/**
 * The climate a chart can draw: everything a device measures or is worked out
 * from what it measures - the leaf, the light as lux and as PPFD among them.
 * `offline` is a state rather than a curve and is not one of them.
 */
export const CHART_METRICS: Metric[] = ['temperature', 'humidity', 'vpd', 'co2', 'leafTemperature', 'lux', 'ppfd'];

/** In the order the board puts them: what a grower steers first stands first, and the rest live behind "+ more". */
export const CHART_OUTPUTS: OutputMetric[] = ['light', 'dehumidifier', 'heater', 'co2', 'fan', 'fanInternal', 'fanExternal', 'fanBackwall', 'relais'];

/** Every line asked for, as the parameters that name them. */
const LINES = { metrics: CHART_METRICS, outputs: CHART_OUTPUTS };

export interface SeriesWindow {
  range: GrowSeriesRange;
  /** Both ends of a `custom` range, as a date field speaks them; the server refuses one without the other. */
  from?: string;
  to?: string;
  /** The keys of the grow's own measurements worth asking about, which is the ones it charts. */
  measurements: string[];
  /** The step somebody chose; left out, the width of the window decides it. */
  stepSeconds?: number;
  /** False asks for the grow's own measurements and its day counter alone, and reads no climate at all. */
  lines?: boolean;
  /** How often to ask again while somebody watches the chart live; off by default. */
  refetchMs?: number | false;
}

/**
 * A custom range is the one window the chips cannot name, so it is the one that
 * can be asked for incomplete - or backwards, which is the same thing twice
 * over: the route names both ends and ends after it begins, and refuses
 * anything else for good. A refusal that will never change on a retry is not a
 * read to make and then report, so it is not made.
 *
 * Both ends are written the one way the contract spells an instant, which is
 * UTC to the millisecond, so the two sort in the order they run.
 */
const askable = (window: SeriesWindow): boolean => window.range !== 'custom' || (!!window.from && !!window.to && window.from < window.to);

export const useGrowSeries = (growId: string | null, window: SeriesWindow) => {
  const client = useQueryClient();
  const { refetchMs = false, ...asked } = window;
  const query = useRead({
    queryKey: ['grow', growId, 'series', asked],
    queryFn: ({ signal }) =>
      api.get<GrowSeries>(
        `/grows/${growId}/series`,
        {
          range: asked.range,
          ...(asked.from && asked.to ? { from: asked.from, to: asked.to } : {}),
          stepSeconds: asked.stepSeconds || undefined,
          ...(asked.lines !== false ? LINES : {}),
          measurements: asked.measurements,
        },
        signal,
      ),
    enabled: growId !== null && askable(asked),
    placeholderData: keepPreviousData,
    refetchInterval: refetchMs,
  });

  return { ...query, held: query.data ? null : lastOf<GrowSeries>(client, ['grow', growId, 'series'], growId) };
};

/** The window of a place: two instants, and the step where somebody chose one. */
interface SpanWindow {
  from: string;
  to: string;
  stepSeconds?: number;
  refetchMs?: number | false;
}

/**
 * Everything the Charts view draws of a place, over any two instants - which
 * is how a place with no grow is charted at all, and how any window that is
 * not a stretch of a grow is read: a year back, the last twenty minutes, a
 * fortnight a month ago. Like a grow's, the answer in hand stays drawn until
 * the next one arrives, and the last that did arrive is handed back beside a
 * read that failed.
 */
export const useSpaceSeries = (spaceId: string | null, window: SpanWindow | null) => {
  const client = useQueryClient();
  const { refetchMs = false, ...asked } = window ?? { from: '', to: '' };
  const query = useRead({
    queryKey: ['space', spaceId, 'series', asked],
    queryFn: ({ signal }) =>
      api.get<SpaceSeries>(
        `/spaces/${spaceId}/series`,
        { from: asked.from, to: asked.to, stepSeconds: asked.stepSeconds || undefined, ...LINES },
        signal,
      ),
    enabled: spaceId !== null && window !== null && asked.from < asked.to,
    placeholderData: keepPreviousData,
    refetchInterval: refetchMs,
  });

  return { ...query, held: query.data ? null : lastOf<SpaceSeries>(client, ['space', spaceId, 'series'], spaceId) };
};

/** The freshest answer about this grow or place that really arrived, whichever window asked for it, and when it did. */
const lastOf = <T>(client: QueryClient, queryKey: unknown[], id: string | null): { data: T; at: number } | null => {
  if (id === null) return null;

  return client
    .getQueryCache()
    .findAll({ queryKey })
    .reduce<{ data: T; at: number } | null>((found, one) => {
      const state = one.state as { data?: T; dataUpdatedAt: number };

      return state.data && (!found || state.dataUpdatedAt > found.at) ? { data: state.data, at: state.dataUpdatedAt } : found;
    }, null);
};
