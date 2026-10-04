import { DateTime } from 'luxon';

/**
 * The clock every age on a screen is measured against, which is the server's
 * and not this browser's.
 *
 * Every instant the app draws an age from - a device's last sample, an alert's
 * start, a session's last use, a picture's capture - was stamped by the server.
 * Subtracting them from a browser's own clock measures the gap between the two
 * clocks as much as the age of the thing, and a laptop half an hour fast then
 * calls a controller that answered a second ago half an hour dead. Nothing on
 * the wire says so, because each figure on its own looks plausible.
 *
 * The offset between the two is learned from the answers the app already
 * receives rather than from a route of its own: every HTTP response carries the
 * instant the server wrote it in its `Date` header, so one is measured on every
 * call the app makes anyway, from the first one. Until one has been read the
 * offset is zero, which is the browser's clock and so exactly what the app drew
 * before - a stripped header or an old server costs nothing beyond that.
 *
 * What this is not: it does not correct the browser's clock, and it does not
 * change the zone anything is drawn in. It moves an instant, and the reader
 * keeps reading their own wall time.
 */

/**
 * An HTTP date names a second, so the instant it stands for is somewhere in the
 * second it names and taking that second's middle halves the worst the reading
 * can be out by.
 */
const STAMP_RESOLUTION_MS = 1000;

/**
 * How far apart the two clocks may be found to be before the reading is taken
 * as a clock that moved rather than as a slow answer: a laptop that woke from
 * sleep, or somebody correcting the time. Below it a reading is only taken when
 * it brackets the offset more tightly than the one in hand.
 */
const MOVED_MS = 5_000;

let offsetMs = 0;
/**
 * The round trip of the answer the offset was learned from. The server stamps
 * its response somewhere between the request leaving and the answer arriving,
 * so a short round trip brackets the true offset more tightly than a long one -
 * which is why the fastest answer so far is kept rather than the newest.
 */
let bracketMs = Number.POSITIVE_INFINITY;

const listeners = new Set<() => void>();

/**
 * What an answer says about the server's clock: its `Date` header, the instant
 * the request left and the instant its headers arrived, both by this browser's
 * own reckoning. A pair of local instants subtracted from each other is a
 * stopwatch, so the browser being wrong about the hour does not disturb them.
 */
export const noteServerDate = (header: string | null, sentAt: number, answeredAt: number): void => {
  if (!header) return;

  const stamped = Date.parse(header);
  const roundTrip = answeredAt - sentAt;
  if (Number.isNaN(stamped) || roundTrip < 0) return;

  const measured = stamped + STAMP_RESOLUTION_MS / 2 - (sentAt + answeredAt) / 2;
  const moved = Math.abs(measured - offsetMs) > roundTrip / 2 + MOVED_MS;
  if (!moved && roundTrip >= bracketMs) return;

  bracketMs = moved ? roundTrip : Math.min(roundTrip, bracketMs);
  if (measured === offsetMs) return;

  offsetMs = measured;
  for (const listener of listeners) listener();
};

/** Now, as the server would stamp it, in the zone the reader is sitting in. */
export const serverNow = (): DateTime => DateTime.now().plus({ milliseconds: offsetMs });

/**
 * An instant this browser noted for itself - when a read answered, when a
 * refresh failed - written the way the server would have stamped it, so that
 * the age drawn beside it is a subtraction of two instants on the same clock.
 */
export const fetchedAt = (browserMillis: number): string =>
  DateTime.fromMillis(browserMillis + offsetMs)
    .toUTC()
    .toISO()!;

/** Told when the offset moves, so that a screen showing an age redraws it rather than waiting for its next beat. */
export const onClockLearned = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** How far this browser's clock is behind the server's, in milliseconds. Negative means it runs fast. */
export const clockOffsetMs = (): number => offsetMs;

/** Forgets what was learned, which only a test that measures the learning itself has any use for. */
export const forgetServerClock = (): void => {
  offsetMs = 0;
  bracketMs = Number.POSITIVE_INFINITY;
  for (const listener of listeners) listener();
};
