"use strict";
/**
 * How the clock on a plan's step is read: by the engine that walks the plan
 * every twenty seconds, and by the screens that say what its next pass will do.
 * Read any other way, a screen offers a Confirm the server refuses, or counts
 * down a step the server has already moved on from.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextStepIndex = exports.isOver = exports.elapsedMs = exports.activeStep = exports.durationMs = exports.DURATION_UNIT_MS = void 0;
exports.DURATION_UNIT_MS = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
};
/**
 * A step with no length to measure runs until it is moved on by hand. The plan
 * screen has always allowed one - and a duration that is missing arrives from
 * the migration as a zero - so a step of no length must not be a step that is
 * over the moment it starts, which with a looping plan would walk the whole plan
 * on every tick.
 */
const durationMs = ({ value, unit }) => (value > 0 ? value * exports.DURATION_UNIT_MS[unit] : Number.POSITIVE_INFINITY);
exports.durationMs = durationMs;
const activeStep = (plan) => plan.steps[plan.state.activeStepIndex] ?? null;
exports.activeStep = activeStep;
/**
 * What the active step has served, across every pause it has been through, at
 * `now` (epoch milliseconds).
 *
 * Unclamped. "More time" is implemented by pushing `stepStartedAt` into the
 * future by the length that was added, so between the extension and that
 * instant the step has served a negative amount of its own length. Held at
 * zero, the extension is thrown away: a screen then shows the same few minutes
 * left on a step the server cannot end for hours yet, and withholds its Confirm
 * button just as long.
 */
const elapsedMs = (state, now) => state.pausedElapsedMs + (state.stepStartedAt ? now - new Date(state.stepStartedAt).getTime() : 0);
exports.elapsedMs = elapsedMs;
const isOver = (plan, now) => {
    const step = (0, exports.activeStep)(plan);
    return step !== null && (0, exports.elapsedMs)(plan.state, now) >= (0, exports.durationMs)(step.duration);
};
exports.isOver = isOver;
/** Which step follows the active one: the next, the first again when the plan loops, or none, which ends the plan. */
const nextStepIndex = (plan) => {
    if (plan.state.activeStepIndex < plan.steps.length - 1)
        return plan.state.activeStepIndex + 1;
    return plan.loop ? 0 : null;
};
exports.nextStepIndex = nextStepIndex;
