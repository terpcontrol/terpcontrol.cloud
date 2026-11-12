import { growWeekAt } from '@fg2/shared-types/v1-schemas';
import { decodeCursor } from '@common/v1/pages';
import { GrowDocument, PhaseDocument } from '@database/schemas/v1/grows.schema';
import { latestPhase } from '../grow/grow-serialiser';

/**
 * What a grow's weeks are, as the grow page draws them.
 *
 * A grow's day does not begin at midnight. Day 1 begins at the grow's origin -
 * its start or its earliest phase, whichever came first - so that a grow begun
 * at 23:00 is not two days old within the hour. Weeks are seven of those days,
 * so week 1 is days 1 to 7 and lines up with the feeding scheme's first row.
 *
 * The counting itself is the contract's (`growOriginOf`, `growDayAt`,
 * `growWeekAt`), because the log sheet counts a grow's weeks too - it draws the
 * doses for the day a feed is dated to before the line is written. Everything
 * the grow page draws about a week - its day range, the hour each thumbnail is
 * taken at - follows from that one origin.
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

/** The last instant the grow has anything to say about: the day it ended, or now. */
export const horizonOf = (grow: GrowDocument, now: Date): Date => grow.endedAt ?? now;

/** Every week the grow has lived through, oldest first. The last one is as short as the grow is young. */
export const weeksOf = (origin: Date, horizon: Date): GrowWeekSpan[] =>
  Array.from({ length: growWeekAt(origin, horizon) }, (_, index) => {
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
