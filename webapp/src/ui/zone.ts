import { DateTime } from 'luxon';
import type { Me } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useSession } from '@/api/session';

/**
 * The zone a clock time is drawn in.
 *
 * The account carries one - an IANA name in `preferences.timezone` - and the
 * server means it: quiet hours are read in that zone, so an alarm held back
 * until seven is held back until seven there and nowhere else. A time drawn in
 * the browser's zone instead is therefore not the same time as the one the
 * account was set by, and the two disagree by however far the reader is from
 * their own zone - which is the whole of somebody setting a window by the
 * numbers in front of them and getting a different window.
 *
 * So every clock time the app draws for its owner goes through here, and so
 * does every day boundary read off one - which day a line falls on, which day
 * a task is due - because a day begins where the account is. It is
 * deliberately not about ages: how long ago something was is the same length
 * of time in every zone, and `age.ts` keeps saying it.
 *
 * The shape is here as well as the zone. One instant was drawn as "11:38" on
 * the alerts inbox and "11:38 AM" on the rules screen behind it, because the
 * two screens picked their own format and Luxon's locale presets follow the
 * app's language; a reader comparing the two had no way of knowing it was one
 * moment. So a clock time is written one way everywhere, and `clock` is that
 * way.
 */

/**
 * The account's zone, or null while nothing has answered yet - which leaves
 * Luxon on the browser's.
 *
 * Every step of the way in is optional, because this is read on screens that
 * draw before their reads have landed and an account is answered in pieces on a
 * slow connection: reaching through a half-arrived answer took the whole alerts
 * inbox down to the router's error screen once, which is a stiff price for a
 * clock's zone.
 */
export const zoneOf = (me: Me | undefined): string | null => me?.preferences?.timezone || null;

/** An instant to read in the account's zone. */
export const zoned = (instant: string, zone: string | null): DateTime => {
  const at = DateTime.fromISO(instant);

  return zone ? at.setZone(zone) : at;
};

/** The zone this browser is in, which is what an account that has never said gets offered. */
export const browserZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Every zone this browser knows, for the menu that sets the account's. The list
 * is the platform's rather than one kept here, because a zone is a fact about
 * the world that changes without this app: a browser too old to answer leaves
 * the menu with what the account already holds and what this device is in,
 * which is enough to correct an account that was migrated onto UTC.
 */
export const zoneNames = (): string[] => {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;

  try {
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
};

/**
 * The account's zone where a screen is drawing, which is the one way a screen
 * asks for it.
 *
 * It is a read of the account rather than a prop threaded down from each
 * screen, because a diary row is drawn by six screens and three of them are in
 * files this pass may not touch; the read itself is shared - every caller hits
 * the same cached answer, and a screen that already reads the account for its
 * own reasons costs nothing extra by asking here too.
 *
 * Nobody signed in is a public page, and the demo has no account of its own:
 * both are left on the browser's zone rather than asked for, because the one
 * thing worse than the wrong zone is a public page firing a read it has no
 * session for.
 */
export const useZone = (): string | null => {
  const { user } = useSession();

  return zoneOf(useMe(false, user !== null && user.isDemo !== true).data);
};

/**
 * An instant the app is already carrying as epoch milliseconds - a timeline
 * cursor, a camera's window - read in the account's zone. The same rule as
 * `zoned`, for the half of the app that does its arithmetic in numbers.
 */
export const zonedAt = (millis: number, zone: string | null): DateTime => {
  const at = DateTime.fromMillis(millis);

  return zone ? at.setZone(zone) : at;
};

/**
 * How a clock time is written: 24 hours, no meridiem, in the account's zone.
 *
 * Not a locale preset. `TIME_SIMPLE` is the reader's language rather than
 * their zone, so the same instant came out "11:38" beside "11:38 AM" two taps
 * away, and the German half of the app never saw it happen.
 */
export const CLOCK = 'HH:mm';

/** The day a clock time fell on, for an instant that is not today's. */
export const DATED_CLOCK = 'd MMM HH:mm';

export const clock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(CLOCK);

export const datedClock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(DATED_CLOCK);

/** Now, where the account is, so that "today" and the day a thing falls on are decided in one zone rather than two. */
export const nowThere = (now: DateTime, zone: string | null): DateTime => (zone ? now.setZone(zone) : now);
