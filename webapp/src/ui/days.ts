import { DateTime } from 'luxon';
import { instantOf } from './age';
import { zonedAt } from './zone';

/**
 * The day a date field speaks, and the instant behind it, for every sheet that
 * records something after the fact. A day boundary belongs to the account, so
 * both halves are told its zone and cannot round differently; a caller that
 * means the reader's own calendar passes null.
 */

/** A minute, an hour and a day in milliseconds, for the arithmetic done on epoch instants. */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The shape a date input speaks. It is the machine's rather than the reader's, so it is one shape in every language. */
const FIELD_DAY = 'yyyy-MM-dd';

/** The day part of an instant, where the account is. */
export const dayOf = (at: Date, zone: string | null): string => zonedAt(at.getTime(), zone).toFormat(FIELD_DAY);

/**
 * That day, at the hour the instant already had: a watering remembered at nine in
 * the evening is dated to nine on the day it happened, and moving a phase three
 * days back moves it by three whole days.
 */
export const momentOn = (day: string, clock: Date, zone: string | null): Date => {
  const [year, month, date] = day.split('-').map(Number);

  return zonedAt(clock.getTime(), zone).set({ year, month, day: date }).toJSDate();
};

/**
 * That day from its first moment, for a field that arranges something rather
 * than remembers it: a reminder falls due on a day, not at the hour the sheet
 * was filled in.
 */
export const startOfDayOn = (day: string, zone: string | null): Date =>
  DateTime.fromISO(day, { zone: zone ?? undefined })
    .startOf('day')
    .toJSDate();

/** That day to its last moment: the closing edge of a span of whole days. */
export const endOfDayOn = (day: string, zone: string | null): Date =>
  DateTime.fromISO(day, { zone: zone ?? undefined })
    .endOf('day')
    .toJSDate();

/** A day a date field holds as the contract's instant at one of its edges, or null for a field left empty. */
export const dayEdgeInstant = (day: string, edge: typeof startOfDayOn, zone: string | null): string | null =>
  day ? instantOf(DateTime.fromJSDate(edge(day, zone))) : null;
