/**
 * How far a client's clock may run ahead of this one before "now" from it is
 * "later": an instant further ahead is postdated, and the writes that record
 * what has happened refuse it.
 */
export const CLOCK_SKEW_MS = 60_000;

/**
 * An instant a client stamped, as it is recorded: its own, or this clock's now
 * where the client's ran a little ahead.
 *
 * A browser knows the server's time to the second or so, and a line written
 * "now" is as often stamped a moment after the server's now as before it. Kept
 * as sent, such a line is missing from every read that ends at now - a place's
 * newest lines, a grow as it stands - until the moment has passed, which is
 * after the one read the write itself sets off. Nothing is recorded later
 * than the instant it was written at. An instant beyond the skew is left as it
 * is, for the caller to refuse or to keep.
 */
export const heldToNow = (at: Date, now: Date = new Date()): Date => (at > now && at.getTime() <= now.getTime() + CLOCK_SKEW_MS ? now : at);
