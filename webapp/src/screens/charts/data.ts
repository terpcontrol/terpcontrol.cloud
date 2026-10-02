import type { GrowMeasurementSeries, TimelineCamera, TimelineOutputLane, TimelinePanel, TimelineSpan } from '@fg2/shared-types/v1';
import { useGrowSeries, useSpaceSeries, type SeriesWindow } from '@/api/charts';
import { instant, seriesRangeOf, type ChartWindow } from './span';

/**
 * What the Charts view draws, whichever answer it came out of.
 *
 * A stretch of a grow - its phase, the whole of it - is the grow's answer,
 * because only the grow knows where it stood and when. Every other window is
 * the place's: a place has a history before the grow in it began and after it
 * ends, and a year back is a year of the place, not of whatever grows in it
 * today. Where a grow stands there, its own measurements and its day counter
 * come from the grow beside the place's curves, read without a single point
 * of climate. A grow with no place at all - a diary kept without hardware - is
 * read from the grow alone.
 */
export interface ChartData {
  startsAt: string;
  endsAt: string;
  stepSeconds: number;
  deviceIds: string[] | null;
  climate: TimelinePanel[];
  lastReadingAt: string | null;
  outputs: TimelineOutputLane[];
  nights: TimelineSpan[];
  cameras: TimelineCamera[];
  measurements: GrowMeasurementSeries[];
  /** The instant day 1 of the grow began; null where no grow is charted. */
  originAt: string | null;
  dayFrom: number | null;
  dayTo: number | null;
}

export interface ChartSubject {
  growId: string | null;
  spaceId: string | null;
  /** The grow's own measurements worth asking about. */
  keys: string[];
}

export const useChartData = (subject: ChartSubject, window: ChartWindow | null, stepSeconds: number | undefined, refetchMs: number | false) => {
  const span = window?.kind === 'span' ? { from: instant(window.from), to: instant(window.to) } : null;
  const viaPlace = span !== null && subject.spaceId !== null;

  const growWindow: SeriesWindow = {
    range: window ? seriesRangeOf(window) : 'custom',
    ...(span ?? {}),
    measurements: subject.keys,
    stepSeconds,
    // Beside the place's curves the grow is asked for its own readings alone.
    lines: !viaPlace,
    refetchMs,
  };
  const grow = useGrowSeries(window ? subject.growId : null, growWindow);
  const place = useSpaceSeries(viaPlace ? subject.spaceId : null, viaPlace ? { ...span, stepSeconds, refetchMs } : null);

  const growData = grow.data ?? grow.held?.data;
  const placeData = place.data ?? place.held?.data;
  const primary = viaPlace ? place : grow;

  const data: ChartData | undefined = viaPlace
    ? placeData && {
        ...placeData,
        measurements: growData?.measurements ?? [],
        originAt: growData?.originAt ?? null,
        dayFrom: growData?.dayFrom ?? null,
        dayTo: growData?.dayTo ?? null,
      }
    : growData;

  return {
    data,
    isPending: primary.isPending && data === undefined,
    isError: primary.isError,
    isPlaceholderData: primary.isPlaceholderData,
    dataUpdatedAt: primary.dataUpdatedAt,
    heldAt: primary.held?.at ?? null,
    refetch: () => {
      void primary.refetch();
      if (viaPlace && subject.growId) void grow.refetch();
    },
  };
};
