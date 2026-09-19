/**
 * The day a date field speaks, and the instant behind it.
 *
 * Every sheet that records something after the fact - a watering remembered in
 * the evening, a phase entered on the day it really began, a harvest typed in
 * once the plants are already hanging - asks for a day and never for a time.
 * Both halves of that live here so that one of them cannot start rounding
 * differently from the other.
 */

/** The day part of an instant, in the browser's own zone, which is what a date field speaks. */
export const dayOf = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

/**
 * That day, at the hour the instant already had. Nobody is asked what time it
 * was, and the hour it is being written down at is the closest thing to the
 * truth there is - so a watering remembered at nine in the evening is dated to
 * nine in the evening of the day it happened, and lands in that day's card.
 *
 * Keeping the hour is also what makes a correction's arithmetic exact: moving a
 * phase three days back moves it by three whole days, and the day counter the
 * server keeps moves by three.
 */
export const momentOn = (day: string, clock: Date): Date => {
  const on = new Date(clock);
  const [year, month, date] = day.split('-').map(Number);
  on.setFullYear(year, month - 1, date);

  return on;
};
