import { growDayUpTo } from '@fg2/shared-types/v1-schemas';
import { localOf } from '@common/v1/local-time';
import { decodeCursor } from '@common/v1/pages';
import { Span } from '@common/v1/range';
import { GrowDocument, PhaseDocument } from '@database/schemas/v1/grows.schema';
import { latestPhase } from '../grow/grow-serialiser';

/**
 * The days and weeks a grow is told in: dates on its owner's calendar.
 *
 * A grow's day is a date - "today" is since midnight where the owner is - and
 * its number is counted from the date the grow began on, which is day 1
 * (`growDayAt`, the contract's own count, because the log sheet counts a grow's
 * days and weeks too). Weeks are seven of those dates, so week 1 is days 1 to 7
 * and lines up with the feeding scheme's first row.
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

/** The last instant the grow has anything to say about: the day it ended, or now. */
export const horizonOf = (grow: GrowDocument, now: Date): Date => grow.endedAt ?? now;

/** Where the date an instant falls on begins, on the owner's calendar. */
export const dateStartOf = (at: Date, zone: string | null): Date => localOf(at, zone).startOf('day').toJSDate();

/** Every week the grow has days in, oldest first, up to the date the horizon falls on. */
export const diaryWeeksOf = (origin: Date, horizon: Date, zone: string | null): DiaryWeek[] => {
  const first = localOf(origin, zone).startOf('day');
  // The last instant lived decides the last date, so a grow that ended at midnight has no day after it.
  const count = growDayUpTo(origin, horizon, zone);
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

/**
 * Midday of a date, which is the hour its picture is taken nearest. A fixed
 * hour is what makes a row of days read as one picture a day rather than as
 * whatever the camera last sent.
 */
export const middayOf = (day: Span): Date => new Date((day.startsAt.getTime() + day.endsAt.getTime()) / 2);

/**
 * The phase the grow as a whole was in at an instant, which is what a week is
 * named after. A phase scoped to some of the plants is a split, and a split is
 * told in the timeline rather than by renaming the week everybody else is
 * still in - unless every phase begun by then is one.
 */
export const headlinePhaseAt = (grow: GrowDocument, at: Date): PhaseDocument | null => {
  const started = grow.phases.filter(phase => phase.startedAt <= at);
  const spine = started.filter(phase => phase.plantIds === null);

  return latestPhase(spine.length > 0 ? spine : started);
};

/**
 * The weeks after the one the cursor names. A week is worked out rather than
 * queried, so the cursor is found in the list instead of filtering a collection
 * by it.
 */
export const weeksAfter = <W extends { weekNumber: number }>(weeks: W[], cursor?: string): W[] => {
  if (!cursor) return weeks;

  const { id } = decodeCursor(cursor);
  const index = weeks.findIndex(week => String(week.weekNumber) === id);

  return index < 0 ? [] : weeks.slice(index + 1);
};
