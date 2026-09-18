import type { DurationUnit, PlanStep, StepDuration } from '@fg2/shared-types/v1';
import { StoredPlan, StoredPlanState } from '@database/schemas/v1/plans.schema';

/** How a step's clock is read. Nothing here touches the database, so both the engine and a transition compute it the same way. */

const UNIT_MS: Readonly<Record<DurationUnit, number>> = {
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
export const durationMs = ({ value, unit }: StepDuration): number => (value > 0 ? value * UNIT_MS[unit] : Number.POSITIVE_INFINITY);

export const activeStep = (plan: StoredPlan): PlanStep | null => plan.steps[plan.state.activeStepIndex] ?? null;

/** What the active step has served, across every pause it has been through. */
export const elapsedMs = (state: StoredPlanState, now: Date): number =>
  state.pausedElapsedMs + (state.stepStartedAt ? now.getTime() - state.stepStartedAt.getTime() : 0);

export const isOver = (plan: StoredPlan, now: Date): boolean => {
  const step = activeStep(plan);
  return step !== null && elapsedMs(plan.state, now) >= durationMs(step.duration);
};

/** Which step follows the active one: the next, the first again when the plan loops, or none, which ends the plan. */
export const stepAfterActive = (plan: StoredPlan): number | null => {
  if (plan.state.activeStepIndex < plan.steps.length - 1) return plan.state.activeStepIndex + 1;
  return plan.loop ? 0 : null;
};

/**
 * The state a step runs in from now. What the step asked and what it applied are
 * the step's own, so entering one forgets both rather than inheriting them from
 * the step before.
 */
export const running = (activeStepIndex: number, now: Date): StoredPlanState => ({
  status: 'running',
  activeStepIndex,
  stepStartedAt: now,
  pausedElapsedMs: 0,
  pauseReason: null,
  lastAppliedAt: null,
  confirmationNotifiedAt: null,
});

/** The plan has run its last step and is not looping. It keeps its steps and stands at the first one. */
export const completed = (): StoredPlanState => ({
  status: 'completed',
  activeStepIndex: 0,
  stepStartedAt: null,
  pausedElapsedMs: 0,
  pauseReason: null,
  lastAppliedAt: null,
  confirmationNotifiedAt: null,
});
