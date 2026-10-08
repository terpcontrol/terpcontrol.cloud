/**
 * How the clock on a plan's step is read: by the engine that walks the plan
 * every twenty seconds, and by the screens that say what its next pass will do.
 * Read any other way, a screen offers a Confirm the server refuses, or counts
 * down a step the server has already moved on from.
 */

import type { z } from 'zod';
import type { durationUnit, stepDuration } from './devices.js';

type DurationUnit = z.infer<typeof durationUnit>;
type StepDuration = z.infer<typeof stepDuration>;

/** As much of a plan as its clock is read from. Instants are ISO strings on the wire and dates in the database. */
interface PlanClock<S> {
  steps: readonly S[];
  loop: boolean;
  state: { activeStepIndex: number; pausedElapsedMs: number; stepStartedAt: string | Date | null };
}

export const DURATION_UNIT_MS: Readonly<Record<DurationUnit, number>> = {
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
export const durationMs = ({ value, unit }: StepDuration): number => (value > 0 ? value * DURATION_UNIT_MS[unit] : Number.POSITIVE_INFINITY);

export const activeStep = <S>(plan: PlanClock<S>): S | null => plan.steps[plan.state.activeStepIndex] ?? null;

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
export const elapsedMs = (state: PlanClock<unknown>['state'], now: number): number =>
  state.pausedElapsedMs + (state.stepStartedAt ? now - new Date(state.stepStartedAt).getTime() : 0);

export const isOver = (plan: PlanClock<{ duration: StepDuration }>, now: number): boolean => {
  const step = activeStep(plan);
  return step !== null && elapsedMs(plan.state, now) >= durationMs(step.duration);
};

/** Which step follows the active one: the next, the first again when the plan loops, or none, which ends the plan. */
export const nextStepIndex = (plan: PlanClock<unknown>): number | null => {
  if (plan.state.activeStepIndex < plan.steps.length - 1) return plan.state.activeStepIndex + 1;
  return plan.loop ? 0 : null;
};
