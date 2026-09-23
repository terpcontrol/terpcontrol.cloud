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
 *
 * All of that was written for hours and only ever enforced for hours, which
 * left the dates behind. A grow's start and end were read straight off the
 * instant in whatever zone the browser was in, so an account in UTC whose
 * owner opened the archive from Tokyo was told the grow ended a day later than
 * it did; and the sessions list on Me reached for a locale preset and printed
 * "Oct 23, 2026" two taps from an archive printing "24 Aug 2026". A date is a
 * day boundary read off an instant, which is exactly what the rule above
 * already claims, so `DAY` and `calendarDay` are to a date what `CLOCK` and
 * `clock` are to an hour.
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

/**
 * How a date is written: the day, the month in the reader's own three letters,
 * then the year.
 *
 * Not a locale preset, for the same reason `CLOCK` is not one. Luxon's
 * `DATE_MED` resolves through the language the app is being read in, and its
 * English resolves to the American order, so the sessions list on Me said
 * "Oct 23, 2026" while the archive one screen away said "24 Aug 2026" about
 * the same kind of thing. The month stays in words rather than becoming a
 * number because a date written in digits is read in a different order on
 * either side of an ocean and there is no way for the reader to tell which one
 * they are looking at.
 */
export const DAY = 'd LLL yyyy';

/**
 * The same day with the year left off, for the places that have already said
 * which year they are talking about - an invitation that expires this week, a
 * backdated start a fortnight ago. It is the one abbreviation of `DAY` there
 * is, so that a screen wanting a shorter date has somewhere to go other than a
 * format of its own.
 */
export const DAY_IN_YEAR = 'd LLL';

/**
 * The same short day with its weekday in front, for a list of what is coming
 * rather than of what happened: a task falls due on a day of this week before
 * it falls due on a date, and the weekday is what the week is planned by.
 *
 * It is built out of `DAY_IN_YEAR` rather than spelled out again, so that the
 * date inside it cannot quietly take a second order. Tasks had a shape of its
 * own through a locale preset and wrote "Wed, Sep 16" in English and
 * "Mi., 16. Sept." in German, two taps from an archive writing "24 Aug 2026"
 * in both.
 */
export const WEEKDAY_DAY = `ccc ${DAY_IN_YEAR}`;

/**
 * A day in digits, for the one column too narrow to hold a month in words: the
 * plant's diary gives each line a five-character slot, which holds "D 218" and
 * would not hold "18 Sep 2026". The day still comes first, as it does in `DAY`,
 * so that the short form and the long one cannot be read in two different
 * orders by the same person.
 */
export const NARROW_DAY = 'dd.MM';

export const clock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(CLOCK);

export const datedClock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(DATED_CLOCK);

/** The day an instant fell on, where the account is - because which day that is depends on the zone it is asked in. */
export const calendarDay = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(DAY);

/** Now, where the account is, so that "today" and the day a thing falls on are decided in one zone rather than two. */
export const nowThere = (now: DateTime, zone: string | null): DateTime => (zone ? now.setZone(zone) : now);
