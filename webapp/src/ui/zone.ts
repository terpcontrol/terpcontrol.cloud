import i18next from 'i18next';
import { useAccountMe } from '@/api/account';
import { DateTime } from 'luxon';
import type { Me } from '@fg2/shared-types/v1';

/**
 * The zone and the shape a clock time or a date is drawn in.
 *
 * The account's `preferences.timezone` is the zone the server reads quiet hours
 * in, so every clock time and every day boundary drawn for its owner is read in
 * it here; an age is the same length in every zone and stays in `age.ts`. Clock
 * times and dates have one shape each (`CLOCK`, `DAY` and the formats built from
 * it) rather than Luxon's locale presets, which follow the language, not the zone.
 */

/**
 * The account's zone, or null while nothing has answered yet - which leaves
 * Luxon on the browser's. Every step is optional, because an account can be
 * answered in pieces and a screen draws before its reads land.
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
 * is the platform's, because zones change without this app; a browser that
 * cannot answer leaves the menu with the account's zone and this device's.
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
 * The account's zone where a screen is drawing: a read of the account, shared
 * through the query cache, rather than a prop threaded down. A public page and
 * the demo stay on the browser's zone, because neither has an account to read.
 */
export const useZone = (): string | null => zoneOf(useAccountMe().data);

/**
 * An instant the app is already carrying as epoch milliseconds - a timeline
 * cursor, a camera's window - read in the account's zone. The same rule as
 * `zoned`, for the half of the app that does its arithmetic in numbers.
 */
export const zonedAt = (millis: number, zone: string | null): DateTime => {
  const at = DateTime.fromMillis(millis);

  return zone ? at.setZone(zone) : at;
};

/** How a clock time is written: 24 hours, no meridiem. Not `TIME_SIMPLE`, whose shape follows the language. */
export const CLOCK = 'HH:mm';

/**
 * How a date is written: the day, the month in the reader's three letters, the
 * year. Not `DATE_MED`, whose English is the American order; the month stays a
 * word because a date in digits reads in different orders in different places.
 * Only the mark after the day follows the language ("19. Sep 2026" in German),
 * so the formats are set by `followDateLanguage` below.
 */
export let DAY = 'd LLL yyyy';

/** `DAY` without the year, for a place that has already said which year it means. */
export let DAY_IN_YEAR = 'd LLL';

/** The short day with its weekday in front, for a list of what is coming; built from `DAY_IN_YEAR`, so the date in it has one order. */
export let WEEKDAY_DAY = `ccc ${DAY_IN_YEAR}`;

/**
 * The day a clock time fell on, and the same with the year. Built from the dates
 * above, because Luxon's `MMM` (the month inside a date) and `LLL` (the month on
 * its own) are spelled alike in English but not in German.
 */
export let DATED_CLOCK = `${DAY_IN_YEAR} ${CLOCK}`;

export let DATED_CLOCK_WITH_YEAR = `${DAY} ${CLOCK}`;

/**
 * Sets the date formats above for a language. They are live bindings, so a
 * screen that imported them reads the new ones on its next render, which the
 * language switch itself causes. It follows i18next rather than being called
 * from it, so that the i18n module does not have to know about dates.
 */
export const followDateLanguage = (language: string): void => {
  const day = language === 'de' ? `d'.'` : 'd';
  DAY = `${day} LLL yyyy`;
  DAY_IN_YEAR = `${day} LLL`;
  WEEKDAY_DAY = `ccc ${DAY_IN_YEAR}`;
  DATED_CLOCK = `${DAY_IN_YEAR} ${CLOCK}`;
  DATED_CLOCK_WITH_YEAR = `${DAY} ${CLOCK}`;
};

i18next.on('languageChanged', followDateLanguage);
if (i18next.language) followDateLanguage(i18next.language);

/**
 * A day in digits, for the one column too narrow to hold a month in words: the
 * plant's diary gives each line a five-character slot, which holds "D 218" and
 * would not hold "18 Sep 2026". The day still comes first, as it does in `DAY`,
 * so that the short form and the long one cannot be read in two different
 * orders by the same person.
 */
export const NARROW_DAY = 'dd.MM';

export const clock = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(CLOCK);

/** The day an instant fell on, where the account is - because which day that is depends on the zone it is asked in. */
export const calendarDay = (instant: string, zone: string | null): string => zoned(instant, zone).toFormat(DAY);

/** Now, where the account is, so that "today" and the day a thing falls on are decided in one zone rather than two. */
export const nowThere = (now: DateTime, zone: string | null): DateTime => (zone ? now.setZone(zone) : now);
