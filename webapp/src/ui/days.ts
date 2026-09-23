import { zonedAt } from './zone';

/**
 * The day a date field speaks, and the instant behind it.
 *
 * Every sheet that records something after the fact - a watering remembered in
 * the evening, a phase entered on the day it really began, a harvest typed in
 * once the plants are already hanging - asks for a day and never for a time.
 * Both halves of that live here so that one of them cannot start rounding
 * differently from the other.
 *
 * Which day an instant falls on is a day boundary, and a day boundary belongs
 * to the account: a grower picks a day their tent stood through, not a day the
 * laptop they typed on happened to be in. Read on the browser's calendar
 * instead, these fields opened a day ahead of the account and filed what was
 * picked on it into the day before - a note dated to the account's today from a
 * browser already into tomorrow went in a grow day early, and the cap offered a
 * day the account had not reached. So both halves are told the zone, and a
 * caller that really does mean the reader's own calendar says so by passing
 * null.
 */

/** The shape a date input speaks. It is the machine's rather than the reader's, so it is one shape in every language. */
const FIELD_DAY = 'yyyy-MM-dd';

/** The day part of an instant, where the account is. */
export const dayOf = (at: Date, zone: string | null): string => zonedAt(at.getTime(), zone).toFormat(FIELD_DAY);

/**
 * That day, at the hour the instant already had and in the zone the day was
 * read in. Nobody is asked what time it was, and the hour it is being written
 * down at is the closest thing to the truth there is - so a watering remembered
 * at nine in the evening is dated to nine in the evening of the day it
 * happened, and lands in that day's card.
 *
 * Keeping the hour is also what makes a correction's arithmetic exact: moving a
 * phase three days back moves it by three whole days, and the day counter the
 * server keeps moves by three.
 */
export const momentOn = (day: string, clock: Date, zone: string | null): Date => {
  const [year, month, date] = day.split('-').map(Number);

  return zonedAt(clock.getTime(), zone).set({ year, month, day: date }).toJSDate();
};
