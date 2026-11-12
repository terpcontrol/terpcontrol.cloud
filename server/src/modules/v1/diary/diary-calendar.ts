import { DateTime } from 'luxon';
import { localOf } from '@common/v1/local-time';
import { Span } from '@common/v1/range';

/**
 * The days a grow's diary is told in: dates on its owner's calendar.
 *
 * A grow counts its own days in twenty-four hours from the moment it began
 * (`growDayAt`), which is right for a counter and wrong for a diary: read by
 * that count, a grow begun at three in the afternoon files this morning's
 * watering under yesterday. So a diary day is a date - "today" is since
 * midnight where the owner is - and its number is the day of the grow that
 * begins on it: the date the grow began on is day 1, the next date day 2.
 * Until the hour the grow began at, that is one more than the grow's own
 * counter says for today.
 *
 * Weeks are seven of those dates, so week 1 is days 1 to 7.
 */

export interface DiaryDay extends Span {
  /** `YYYY-MM-DD` on the owner's calendar. */
  date: string;
  dayNumber: number;
}

export interface DiaryWeek extends Span {
  weekNumber: number;
  /** The seven days the week is of, whether or not they have all happened. */
  dayFrom: number;
  dayTo: number;
  /** The days that have begun, oldest first, each a whole date. */
  days: DiaryDay[];
}

const DAYS_A_WEEK = 7;

const startOfDay = (at: Date, zone: string | null): DateTime => localOf(at, zone).startOf('day');

/** The diary day an instant falls on: 1 on the date the grow began, and for anything before it. */
export const diaryDayAt = (origin: Date, at: Date, zone: string | null): number =>
  Math.max(1, Math.round(startOfDay(at, zone).diff(startOfDay(origin, zone), 'days').days) + 1);

/** Every week the diary has days in, oldest first, up to the date the horizon falls on. */
export const diaryWeeksOf = (origin: Date, horizon: Date, zone: string | null): DiaryWeek[] => {
  const first = startOfDay(origin, zone);
  // The last instant lived decides the last date, so a grow that ended at midnight has no day after it.
  const count = diaryDayAt(origin, new Date(Math.max(origin.getTime(), horizon.getTime() - 1)), zone);
  const days: DiaryDay[] = Array.from({ length: count }, (_, index) => {
    const startsAt = first.plus({ days: index });
    return {
      date: startsAt.toFormat('yyyy-MM-dd'),
      dayNumber: index + 1,
      startsAt: startsAt.toJSDate(),
      endsAt: startsAt.plus({ days: 1 }).toJSDate(),
    };
  });

  return Array.from({ length: Math.ceil(count / DAYS_A_WEEK) }, (_, index) => {
    const lived = days.slice(index * DAYS_A_WEEK, (index + 1) * DAYS_A_WEEK);
    return {
      weekNumber: index + 1,
      dayFrom: index * DAYS_A_WEEK + 1,
      dayTo: (index + 1) * DAYS_A_WEEK,
      startsAt: lived[0].startsAt,
      endsAt: first.plus({ days: (index + 1) * DAYS_A_WEEK }).toJSDate(),
      days: lived,
    };
  });
};
