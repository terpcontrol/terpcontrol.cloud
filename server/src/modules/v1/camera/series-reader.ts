import { DeviceSeries, Metric, OutputMetric } from '@fg2/shared-types/v1';

/**
 * A window of what a controller measured, which the composer needs for two of
 * its options: the climate curve it draws over the frames, and the light output
 * that says which frames were taken in the dark.
 *
 * The readings live in the series store, so the device part provides this. A
 * camera pipeline that has nobody to ask simply draws no curve and keeps every
 * frame, which is the same rule `nightOff` follows.
 */
export interface SeriesReader {
  series(
    deviceId: string,
    request: { metrics: readonly Metric[]; outputs?: readonly OutputMetric[]; startsAt: Date; endsAt: Date; stepSeconds?: number },
  ): Promise<DeviceSeries>;
}

export const SERIES_READER = Symbol('SeriesReader');
