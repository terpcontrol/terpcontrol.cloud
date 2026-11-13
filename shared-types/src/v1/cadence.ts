import { VALUE_AGE } from './value-age.js';

/**
 * What a silence is, in one place: a device is silent where it said nothing
 * for clearly longer than the interval it was keeping there - not where a
 * drawn window happens to stand empty. The server's read decides it, for the
 * curve, the lanes and the nights alike, and the answer carries the verdict:
 * no screen works it out a second time.
 *
 * Firmware reports every five seconds, a backfilled history every quarter of an
 * hour, and one device does both in the same window: its history up to the day
 * it was plugged in, live samples since. So the interval is read beside each
 * gap, not once for the window. Measured once, the live half of three days
 * outvoted the history, and every second point of the history was "a silence":
 * 36 lamp stretches and 64 nights where the samples had three.
 */

/**
 * How many of its own intervals a device may say nothing for before it has
 * stopped, rather than been slow. Four and a half: a pause of four intervals -
 * three reports missed - is slow, one of five is a silence, and the line is
 * drawn halfway between them so that neither verdict hangs on the last tenth
 * of how the interval was measured.
 */
export const SILENT_AFTER = 4.5;

/**
 * The slowest interval a device is taken to keep. Nothing reports more slowly
 * than the backfilled history's quarter of an hour, so a device heard less
 * often than that is one that gets a few samples through - a lost connection,
 * which is what a grower wants to see - and not one keeping a rhythm: three
 * samples every two hours were drawn as an unbroken day.
 */
export const SLOWEST_INTERVAL_MS = 15 * 60_000;

/** How many gaps either side of one say what interval the device was keeping there. */
const NEAR = 12;

/** Below this step a window is somebody looking closely, and a restart is the very thing looked for. */
const FINE_STEP_MS = 60_000;

/** The least silence that breaks a line read that closely: longer than a slow sample, shorter than a restart. */
const FINE_SILENCE_MS = 30_000;

/** And never fewer windows than this, read that closely. */
const FINE_WINDOWS = 4;

/** The least any silence is at a step, whatever the device's rhythm: what a limit above it owes to the device, and one at it to the step. */
export const leastSilence = (stepMs: number): number =>
  stepMs < FINE_STEP_MS ? Math.max(FINE_SILENCE_MS, FINE_WINDOWS * stepMs) : Math.max(VALUE_AGE.liveSeconds * 1000, stepMs);

/**
 * How long a device may say nothing at each place in a row of drawn windows
 * before that is a silence.
 *
 * `stamps` are the closes of the windows it was heard in, in order, and
 * `samples` how many samples it wrote in each of them, where somebody
 * counted. The answer has one figure more than there are stamps: `[i]` is for
 * the gap between stamp `i - 1` and stamp `i`, `[0]` for what lies before the
 * first and the last for what lies after the last.
 *
 * The interval the device was keeping beside a gap is pooled: the time of the
 * twelve gaps before it by the samples that closed them, and the same of the
 * twelve after it, the slower side counting - the last quarter of an hour of
 * a history is not a silence because live samples follow it. Pooled, because
 * a gap taken by itself says 12.5 minutes where its window held two samples
 * and 25 where it held one, and the same pause was a line at one range and a
 * silence at the next; over twelve gaps a steady device is measured to a
 * twelfth, which keeps the limit between four of its intervals and five. A
 * gap more than twice the usual one of its run is a pause itself and is left
 * out of the pool. Uncounted, a device that fills every window is taken to
 * report faster than it is drawn, as it always was.
 *
 * Never less than the step - two neighbouring windows are no silence - nor
 * than the two minutes after which the rest of the app calls a reading stale;
 * read finer than a minute, never less than four windows or half a minute.
 */
export const quietLimits = (stamps: readonly number[], stepMs: number, samples: readonly (number | undefined)[] = []): number[] => {
  const least = leastSilence(stepMs);
  const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
  const heard = gaps.map((gap, index) => samples[index + 1] ?? (gap > stepMs ? 1 : Number.POSITIVE_INFINITY));
  const pooled = (from: number, to: number): number | undefined => {
    const [first, last] = [Math.max(0, from), Math.min(gaps.length, to)];
    if (last <= first) return undefined;
    const usual = gaps.slice(first, last).sort((one, other) => one - other)[(last - first) >> 1];
    let [time, count] = [0, 0];
    for (let index = first; index < last; index++) if (gaps[index] <= 2 * usual) [time, count] = [time + gaps[index], count + heard[index]];
    return time / count;
  };

  // Where a side of a gap has no other to be measured by - the first and the last of a window - the gap stands in
  // for it, by the fewer samples of the two windows it lies between: a device that reported every quarter of an
  // hour until live samples began is not silent in the first quarter of an hour the window holds.
  const alone = (index: number): number => {
    const gap = Math.min(Math.max(index - 1, 0), gaps.length - 1);
    return gaps.length === 0 ? 0 : gaps[gap] / Math.min(heard[gap], samples[gap] ?? heard[gap]);
  };

  return Array.from({ length: stamps.length + 1 }, (_, index) => {
    const interval = Math.max(pooled(index - 1 - NEAR, index - 1) ?? alone(index), pooled(index, index + NEAR) ?? alone(index));
    return Math.max(least, SILENT_AFTER * Math.min(SLOWEST_INTERVAL_MS, interval));
  });
};
