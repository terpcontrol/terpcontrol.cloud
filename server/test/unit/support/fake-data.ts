import type { DeviceSeries, Metric, OutputMetric } from '@fg2/shared-types/v1';
import type { OutputHistory, SeriesRequest } from '@modules/data/data.service';

/**
 * The pieces a spec's fake `DataService` is put together from. Each spec keeps
 * its own scenario - what a device read and when its lamp was on - and hands
 * it in; the shape of what the store answers is the same for all of them.
 */

/** The lamp's own day: on from six in the morning until six in the evening. */
export const isLit = (at: Date): boolean => at.getUTCHours() >= 6 && at.getUTCHours() < 18;

/**
 * How finely the store is taken to look for a switching, which is a grain of
 * its own and not the step the curve is drawn with. The fake keeps them apart
 * because that is the whole of what the second read buys: a window wider than
 * the cycle still answers the cycle.
 */
const SWITCHING_GRAIN_MS = 300 * 1000;

/**
 * What the store answers about the outputs: the state the window opens in, then
 * every switching. `isOn` is null for an instant the output said nothing at.
 */
export const switchingsOf = (request: SeriesRequest, isOn: (output: OutputMetric, at: Date) => boolean | null): OutputHistory[] =>
  (request.outputs ?? []).map(output => {
    const switchings: { at: string; on: boolean }[] = [];
    let last: boolean | null = null;

    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += SWITCHING_GRAIN_MS) {
      const on = isOn(output, new Date(at));
      if (on === null) continue;

      if (on !== last) switchings.push({ at: new Date(at).toISOString(), on });
      last = on;
    }

    return { output, switchings };
  });

/**
 * The newest raw sample the fake device wrote, which the store answers from a
 * read of its own. Here it is the newest window anything was reported in: the
 * fake stamps a window at the instant it opens, so the two are the same and the
 * lane is cut exactly where it always was.
 */
export const lastSampleOf = (series: DeviceSeries): string | null =>
  [...series.metrics, ...series.outputs]
    .flatMap(one => one.points.flatMap(point => (point.value === null ? [] : [point.measuredAt])))
    .sort()
    .at(-1) ?? null;

/** A device's series over the window asked for, a point at the start of every step, each read off `read`. */
export const seriesOf = (
  deviceId: string,
  request: SeriesRequest,
  read: { metric: (metric: Metric, at: Date) => number | null; output: (output: OutputMetric, at: Date) => number | null },
): DeviceSeries => {
  const step = (request.stepSeconds ?? 60) * 1000;
  const instants: Date[] = [];
  for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += step) instants.push(new Date(at));

  return {
    deviceId,
    startsAt: request.startsAt.toISOString(),
    endsAt: request.endsAt.toISOString(),
    stepSeconds: request.stepSeconds ?? 60,
    metrics: request.metrics.map(metric => ({
      metric,
      points: instants.map(at => ({ measuredAt: at.toISOString(), value: read.metric(metric, at) })),
    })),
    outputs: (request.outputs ?? []).map(output => ({
      output,
      points: instants.map(at => ({ measuredAt: at.toISOString(), value: read.output(output, at) })),
    })),
  };
};
