/**
 * How long a grow spent in each of its stages, and which week of a stage a week
 * of the grow is.
 *
 * Both are read in more than one place and were counted in more than one way.
 * The phase bar above the tabs measured the milliseconds between two phase
 * starts and rounded them; the report's chapters counted the grow's own day
 * numbers; and because a phase rarely begins on a grow-day boundary the two
 * answered differently for the same phase - a bar reading "Flower 79 d" over
 * chapters reading "81 d", and chapters that summed to five days more than the
 * grow they belonged to. The stage week had the same shape of fault: the header
 * divided the phase's own day count by seven while the week card beside it
 * counted the grow weeks the stage had touched.
 *
 * So both are stated once, here, beside `growDayAt`, which is the arithmetic
 * they are both built on: a stage's span is a stretch of the grow's days, and a
 * stage's week is a difference of the grow's weeks. A screen and the server that
 * answers it read the same function, and there is no second copy left to drift.
 */
import type { z } from 'zod';
import type { growthStage } from './common.js';
import { type GrowDays } from './feeding.js';
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
/**
 * The grow's spine: the phases the whole grow went through, oldest first. A
 * phase scoped to some of the plants is a split - "4 drying in the fridge" -
 * and a span that covered half the plants would say the grow was drying while
 * most of it was still in flower.
 */
export declare const spineOf: <P extends StagePhase>(phases: readonly P[], horizon: Date) => P[];
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
export declare const stageSpansOf: <P extends StagePhase>(grow: GrowSpine & {
    phases: readonly P[];
}, horizon: Date) => StageSpan<P>[];
/**
 * How many days the grow spent in each stage. A stage entered twice - flowering
 * before a late-flower preset and after it - is the sum of both stretches,
 * because the bar draws one segment per stage and not one per phase.
 */
export declare const daysPerStageOf: <P extends StagePhase>(spans: readonly StageSpan<P>[]) => Partial<Record<GrowthStage, number>>;
/**
 * Which week of its stage a week of the grow is: 1 in the week the stage began.
 *
 * It counts the grow's weeks the stage has touched rather than seven-day blocks
 * of the stage itself, which is what makes a week card's pill and the header
 * above it the same figure - a stage begun on a Wednesday is in its second week
 * on the following Monday, the same Monday that begins the grow's next week.
 */
export declare const stageWeekOf: (origin: Date, phaseStartedAt: string | Date, weekNumber: number) => number;
export {};
