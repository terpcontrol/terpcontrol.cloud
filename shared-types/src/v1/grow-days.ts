/**
 * How long a grow spent in each of its stages, and which week of a stage a week
 * of the grow is.
 *
 * Both are stated once, here, beside `growDayAt`, the arithmetic they are built
 * on: a stage's span is a stretch of the grow's days, and a stage's week is a
 * difference of the grow's weeks. Counted any other way - the milliseconds
 * between two phase starts, a phase's own days divided by seven - two screens
 * answer differently for the same phase, and chapters sum to more days than
 * the grow they belong to. A screen and the server that answers it read the
 * same function.
 */

import type { z } from 'zod';
import type { growthStage } from './common.js';
import { growDayAt, growDayUpTo, growOriginOf, growWeekAt, type GrowDays } from './feeding.js';

type GrowthStage = z.infer<typeof growthStage>;

/** As much of a phase as this arithmetic reads. Instants are ISO strings on the wire and dates in the database. */
export interface StagePhase {
  stage: GrowthStage;
  startedAt: string | Date;
  /** Null is every plant of the grow. A phase scoped to some of them is a split and is not part of the spine. */
  plantIds: readonly string[] | null;
}

/** As much of a grow as its stages are read from. */
export interface GrowSpine extends GrowDays {
  phases: readonly StagePhase[];
  endedAt?: string | Date | null;
}

/** One stretch of a grow at one stage, in the grow's own days. */
export interface StageSpan<P extends StagePhase> {
  phase: P;
  stage: GrowthStage;
  startsAt: Date;
  /** Where the next phase took over, or the day the grow ended; null while this is the phase the grow is in. */
  endsAt: Date | null;
  dayFrom: number;
  /** The last day this stage covers. The day before the next phase's first, so the spans are a partition of the grow. */
  dayTo: number;
  dayCount: number;
}

const moment = (at: string | Date): number => new Date(at).getTime();

/**
 * The grow's spine: the phases the whole grow went through, oldest first. A
 * phase scoped to some of the plants is a split - "4 drying in the fridge" -
 * and a span that covered half the plants would say the grow was drying while
 * most of it was still in flower.
 */
export const spineOf = <P extends StagePhase>(phases: readonly P[], horizon: Date): P[] =>
  phases.filter(phase => phase.plantIds === null && moment(phase.startedAt) <= horizon.getTime()).sort((one, other) => moment(one.startedAt) - moment(other.startedAt));

/**
 * Each stage of the grow as the days it covers, counted inclusively from the
 * grow's own origin.
 *
 * A stage's last day is the day *before* the next phase's first, not the day the
 * next phase started on, so that the spans tile the grow exactly: six phases of
 * a 218-day grow add up to 218 days and not to 223. Where two phases were
 * recorded inside the same grow-day the subtraction would run backwards, so the
 * last day is never allowed below the first and such a stage counts as the one
 * day it had.
 *
 * `horizon` is the last instant the grow has anything to say about - the day it
 * ended, or now - and is passed in rather than taken from the clock, because the
 * server answers a reader whose window may have closed months ago.
 */
export const stageSpansOf = <P extends StagePhase>(grow: GrowSpine & { phases: readonly P[] }, horizon: Date, zone: string | null): StageSpan<P>[] => {
  const origin = growOriginOf(grow);
  const spine = spineOf(grow.phases, horizon);
  const lastDay = growDayUpTo(origin, horizon, zone);
  const ended = grow.endedAt ? new Date(grow.endedAt) : null;

  return spine.map((phase, index) => {
    const next = spine[index + 1];
    const dayFrom = growDayAt(origin, phase.startedAt, zone);
    const dayTo = next ? Math.max(dayFrom, growDayAt(origin, next.startedAt, zone) - 1) : Math.max(dayFrom, lastDay);

    return {
      phase,
      stage: phase.stage,
      startsAt: new Date(phase.startedAt),
      endsAt: next ? new Date(next.startedAt) : ended,
      dayFrom,
      dayTo,
      dayCount: dayTo - dayFrom + 1,
    };
  });
};

/**
 * Which week of its stage a week of the grow is: 1 in the week the stage began.
 *
 * It counts the grow's weeks the stage has touched rather than seven-day blocks
 * of the stage itself, which is what makes a diary week's title and the header
 * above it the same figure - a stage begun on a Wednesday is in its second week
 * on the following Monday, the same Monday that begins the grow's next week.
 */
export const stageWeekOf = (origin: Date, phaseStartedAt: string | Date, weekNumber: number, zone: string | null): number =>
  weekNumber - growWeekAt(origin, phaseStartedAt, zone) + 1;
