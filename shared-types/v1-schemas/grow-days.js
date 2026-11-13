"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageWeekOf = exports.stageSpansOf = exports.spineOf = void 0;
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
const stageSpansOf = (grow, horizon, zone) => {
    const origin = (0, feeding_js_1.growOriginOf)(grow);
    const spine = (0, exports.spineOf)(grow.phases, horizon);
    const lastDay = (0, feeding_js_1.growDayUpTo)(origin, horizon, zone);
    const ended = grow.endedAt ? new Date(grow.endedAt) : null;
    return spine.map((phase, index) => {
        const next = spine[index + 1];
        const dayFrom = (0, feeding_js_1.growDayAt)(origin, phase.startedAt, zone);
        const dayTo = next ? Math.max(dayFrom, (0, feeding_js_1.growDayAt)(origin, next.startedAt, zone) - 1) : Math.max(dayFrom, lastDay);
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
 * Which week of its stage a day of the grow is in: counted from the stage's own
 * start, so days 1 to 7 of the stage are its week 1 and day 8 begins week 2,
 * whatever day of the grow's week the stage began on - "Blüte, Woche 2" on the
 * thirteenth day of flowering is what a grower counts. A day before the stage
 * began is in its week 1.
 */
const stageWeekOf = (origin, phaseStartedAt, day, zone) => Math.max(1, Math.floor((day - (0, feeding_js_1.growDayAt)(origin, phaseStartedAt, zone)) / 7) + 1);
exports.stageWeekOf = stageWeekOf;
