import type { DateTime } from 'luxon';

/**
 * The climate window as the privacy screen offers it, and the two facts about
 * a choice that the row has to work out before it writes anything: whether it
 * keeps less than the account keeps now, and where the sweep would then cut.
 * Pure, so that both can be checked without drawing the screen.
 */

/** The menu's options: a window in days, or nothing said - which the server hands on to the install's own setting. */
export const KEEP: { key: string; days: number | null }[] = [
  { key: 'd90', days: 90 },
  { key: 'd180', days: 180 },
  { key: 'd365', days: 365 },
  { key: 'd730', days: 730 },
  { key: 'forever', days: null },
];

/**
 * Whether a choice keeps less than the account keeps now, which is the case
 * that destroys something. "Keep everything" is never narrower than a number,
 * and a number is always narrower than "keep everything".
 */
export const narrows = (current: number | null, next: number | null): boolean => next !== null && (current === null || next < current);

/**
 * The day the sweep would cut at for a window: the start of the UTC day that
 * many days back, which is how the server cuts because a summary is a whole
 * day. It is named in the question so that "90 days" is also a date a person
 * can place their grow against.
 */
export const cutoffDay = (days: number, now: DateTime): DateTime => now.toUTC().startOf('day').minus({ days });
