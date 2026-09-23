import { growDayAt, growOriginOf, growWeekAt, stageWeekOf } from '@fg2/shared-types/v1-schemas';
import { GrowDocument } from '@database/schemas/v1/grows.schema';

/**
 * What a grow's weeks and days are, worked out here and nowhere else.
 *
 * A grow's day does not begin at midnight. Day 1 begins the moment the grow's
 * first phase did, because a grow begun at 23:00 would otherwise be two days old
 * within the hour - which is the rule the day counter in the grow serialiser
 * already counts by. Weeks are seven of those days, so week 1 is days 1 to 7 and
 * lines up with the feeding scheme's first row.
 *
 * The counting itself is the contract's, because the log sheet counts a grow's
 * weeks too - it draws the doses for the day a feed is dated to before the line
 * is written. Everything the grow page draws about a week - its day range, the
 * hour each thumbnail is taken at - follows from that one origin.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface GrowWeekSpan {
  weekNumber: number;
  /** The seven days the week is of, whether or not they have all happened; `endsAt` says how much of it has. */
  dayFrom: number;
  dayTo: number;
  startsAt: Date;
  /** The end of the week, or the moment the grow ended or now, whichever comes first. */
  endsAt: Date;
}

/**
 * Where day 1 starts. The earliest phase, which is what the day counter counts
 * from; a grow that has not entered a phase yet has only the day it was created.
 */
export const originOf = (grow: GrowDocument): Date => growOriginOf(grow);

/** The last instant the grow has anything to say about: the day it ended, or now. */
export const horizonOf = (grow: GrowDocument, now: Date): Date => grow.endedAt ?? now;

export const dayNumberOf = growDayAt;

/** Which row of a feeding grid the grow is on at that moment: week 1 is days 1 to 7. */
export const weekNumberOf = growWeekAt;

/**
 * Which week of its stage one of those weeks is: 1 in the week the stage began.
 * The grow serialiser answers the same figure for the grow as a whole, from the
 * same function, so a week card's pill and the header above it cannot drift.
 */
export const stageWeekIn = stageWeekOf;

/** Every week the grow has lived through, oldest first. The last one is as short as the grow is young. */
export const weeksOf = (origin: Date, horizon: Date): GrowWeekSpan[] => {
  const lastDay = dayNumberOf(origin, horizon);
  const weeks = Math.floor((lastDay - 1) / 7) + 1;

  return Array.from({ length: weeks }, (_, index) => {
    const weekNumber = index + 1;
    const startsAt = new Date(origin.getTime() + index * WEEK_MS);

    return {
      weekNumber,
      dayFrom: index * 7 + 1,
      dayTo: weekNumber * 7,
      startsAt,
      endsAt: new Date(Math.min(startsAt.getTime() + WEEK_MS, horizon.getTime())),
    };
  });
};

/**
 * Midday, which is the hour each day's thumbnail is taken nearest.
 *
 * A fixed hour is what makes seven pictures read as one a day rather than as
 * whatever the camera last sent. It is an hour of the clock rather than the
 * middle of the grow's own day, because the picture has to be taken in the
 * light: a grow begun at eight in the evening has the middle of its day at
 * eight in the morning, and one begun at eight in the morning has it at eight in
 * the evening, when half the tents in Europe are dark.
 *
 * Each of the grow's days is twenty-four hours long wherever it begins, so
 * exactly one midday falls inside it.
 */
const PICTURE_HOUR_UTC = 12;

export const pictureHourIn = (dayStartsAt: Date): Date => {
  const midday = new Date(dayStartsAt);
  midday.setUTCHours(PICTURE_HOUR_UTC, 0, 0, 0);

  return midday >= dayStartsAt ? midday : new Date(midday.getTime() + DAY_MS);
};
