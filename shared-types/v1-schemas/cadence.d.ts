/**
 * What a silence is, in the one place the server's read and the screen's
 * drawing take it from: a device is silent where it said nothing for clearly
 * longer than the interval it was keeping there - not where a drawn window
 * happens to stand empty.
 *
 * Firmware reports every five seconds, a backfilled history every quarter of an
 * hour, and one device does both in the same window: its history up to the day
 * it was plugged in, live samples since. So the interval is read beside each
 * gap, not once for the window. Measured once, the live half of three days
 * outvoted the history, and every second point of the history was "a silence":
 * 36 lamp stretches and 64 nights where the samples had three.
 */
/**
 * How many of its own intervals in a row a device may miss before it has
 * stopped, rather than been slow once. Four: one missed report is a slow
 * sample, and a device sampled into windows about as wide as its interval
 * leaves every other one empty without missing anything - a factor of two
 * would call that a silence, three would do so on the day its rhythm drifts.
 * It is the factor the lanes and the curve already went by for a slow device.
 */
export declare const SILENT_AFTER = 4;
/**
 * How long a device may say nothing at each place in a row of drawn windows
 * before that is a silence.
 *
 * `stamps` are the closes of the windows it was heard in, in order, and
 * `samples` how many samples it wrote in each of them, where somebody
 * counted. The answer has one figure more than there are
 * stamps: `[i]` is for the gap between stamp `i - 1` and stamp `i`, `[0]` for
 * what lies before the first and the last for what lies after the last.
 *
 * The interval kept across a gap is the gap by the samples that closed it: a
 * window of 36 samples says five seconds, one of a single sample says the gap
 * itself. Uncounted, a device that fills every window is taken to report
 * faster than it is drawn, as it always was. Beside each gap the usual
 * interval is the middle one of the six gaps before it and of the six after
 * it, and the slower side counts: the last quarter of an hour of a history is
 * not a silence because live samples follow it.
 *
 * Never less than the step - two neighbouring windows are no silence - nor
 * than the two minutes after which the rest of the app calls a reading stale;
 * read finer than a minute, never less than four windows or half a minute.
 */
export declare const quietLimits: (stamps: readonly number[], stepMs: number, samples?: readonly (number | undefined)[]) => number[];
