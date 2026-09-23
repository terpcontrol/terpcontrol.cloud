"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageWeekOf = exports.daysPerStageOf = exports.stageSpansOf = exports.spineOf = void 0;
const feeding_js_1 = require("./feeding.js");
const moment = (at) => new Date(at).getTime();
/**
 * The grow's spine: the phases the whole grow went through, oldest first. A
 * phase scoped to some of the plants is a split - "4 drying in the fridge" -
 * and a span that covered half the plants would say the grow was drying while
 * most of it was still in flower.
 */
const spineOf = (phases, horizon) => phases.filter(phase => phase.plantIds === null && moment(phase.startedAt) <= horizon.getTime()).sort((one, other) => moment(one.startedAt) - moment(other.startedAt));
exports.spineOf = spineOf;
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
const stageSpansOf = (grow, horizon) => {
    const origin = (0, feeding_js_1.growOriginOf)(grow);
    const spine = (0, exports.spineOf)(grow.phases, horizon);
    const lastDay = (0, feeding_js_1.growDayAt)(origin, horizon);
    const ended = grow.endedAt ? new Date(grow.endedAt) : null;
    return spine.map((phase, index) => {
        const next = spine[index + 1];
        const dayFrom = (0, feeding_js_1.growDayAt)(origin, phase.startedAt);
        const dayTo = next ? Math.max(dayFrom, (0, feeding_js_1.growDayAt)(origin, next.startedAt) - 1) : Math.max(dayFrom, lastDay);
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
exports.stageSpansOf = stageSpansOf;
/**
 * How many days the grow spent in each stage. A stage entered twice - flowering
 * before a late-flower preset and after it - is the sum of both stretches,
 * because the bar draws one segment per stage and not one per phase.
 */
const daysPerStageOf = (spans) => {
    const days = {};
    for (const span of spans)
        days[span.stage] = (days[span.stage] ?? 0) + span.dayCount;
    return days;
};
exports.daysPerStageOf = daysPerStageOf;
/**
 * Which week of its stage a week of the grow is: 1 in the week the stage began.
 *
 * It counts the grow's weeks the stage has touched rather than seven-day blocks
 * of the stage itself, which is what makes a week card's pill and the header
 * above it the same figure - a stage begun on a Wednesday is in its second week
 * on the following Monday, the same Monday that begins the grow's next week.
 */
const stageWeekOf = (origin, phaseStartedAt, weekNumber) => weekNumber - (0, feeding_js_1.growWeekAt)(origin, phaseStartedAt) + 1;
exports.stageWeekOf = stageWeekOf;
