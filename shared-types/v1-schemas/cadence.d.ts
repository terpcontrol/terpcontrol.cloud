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
export declare const SILENT_AFTER = 4.5;
/**
 * The slowest interval a device is taken to keep. Nothing reports more slowly
 * than the backfilled history's quarter of an hour, so a device heard less
 * often than that is one that gets a few samples through - a lost connection,
 * which is what a grower wants to see - and not one keeping a rhythm: three
 * samples every two hours were drawn as an unbroken day.
 */
export declare const SLOWEST_INTERVAL_MS: number;
/** The least any silence is at a step, whatever the device's rhythm: what a limit above it owes to the device, and one at it to the step. */
export declare const leastSilence: (stepMs: number) => number;
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
export declare const quietLimits: (stamps: readonly number[], stepMs: number, samples?: readonly (number | undefined)[]) => number[];
