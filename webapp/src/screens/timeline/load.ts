import type { TimelineOutputLane } from '@fg2/shared-types/v1';
import { at } from './window';

/** The most slices a lane is cut into: enough to tell a compressor's cycles apart on a day, few enough to draw cheaply. */
const MOST_SLICES = 160;

/**
 * How hard an output worked across a window, slice by slice, as a share from 0
 * to 1 - or null for a slice after the device was last heard from, about which
 * nothing is known.
 *
 * A slice says how much of its time the output ran, times how hard it ran
 * while it did: a compressor that ran a third of an hour is at a third, a lamp
 * dimmed to 60 % all hour at 60 %, the heater at half its demand for half the
 * hour at a quarter. Over a week the runs of a cycling output are far narrower
 * than a pixel and a lane of bars turns into one solid block; the share is what
 * is left to read there. A slice is never finer than the windows the server
 * read, because the level is known no finer.
 */
export const loadOf = (lane: TimelineOutputLane, from: number, to: number, stepSeconds: number): (number | null)[] => {
  // The header reads a lane on every move of the cursor, so a lane's answer is worked out once per window.
  const key = `${from}-${to}-${stepSeconds}`;
  const known = cache.get(lane);
  if (known?.key === key) return known.load;

  const load = sliced(lane, from, to, stepSeconds);
  cache.set(lane, { key, load });
  return load;
};

const cache = new WeakMap<TimelineOutputLane, { key: string; load: (number | null)[] }>();

const sliced = (lane: TimelineOutputLane, from: number, to: number, stepSeconds: number): (number | null)[] => {
  const step = Math.max(stepSeconds * 1000, 1);
  const count = Math.max(1, Math.min(MOST_SLICES, Math.floor((to - from) / step)));
  const width = (to - from) / count;
  const heard = at(lane.heardUntil);
  const runs = lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) }));
  // A dose counts ticks rather than a share of anything, so the valve's lane says only how much of the time it was open.
  const levels =
    lane.level?.unit === 'percent'
      ? lane.level.points.flatMap(point => (point.value === null ? [] : [{ to: at(point.measuredAt), value: point.value / 100 }]))
      : null;

  return Array.from({ length: count }, (_, index) => {
    const start = from + index * width;
    const end = Math.min(start + width, heard);
    if (end <= start) return null;

    const ran = runs.reduce((sum, run) => sum + Math.max(0, Math.min(run.to, end) - Math.max(run.from, start)), 0) / (end - start);
    if (ran === 0 || levels === null) return ran;

    // A level point closes the window it stands for, so it belongs to every slice that window reaches into.
    const inside = levels.filter(point => point.to > start && point.to - step < end);
    return inside.length === 0 ? ran : (ran * inside.reduce((sum, point) => sum + point.value, 0)) / inside.length;
  });
};

/** The slice a moment falls into. */
export const sliceAt = (load: readonly (number | null)[], from: number, to: number, time: number): number | null =>
  load[Math.min(load.length - 1, Math.max(0, Math.floor(((time - from) / (to - from)) * load.length)))] ?? null;
