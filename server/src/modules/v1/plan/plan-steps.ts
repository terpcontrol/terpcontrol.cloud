import { v4 as uuidv4 } from 'uuid';
import type { DurationUnit, PlanStep, PlanStepInput, StepDuration } from '@fg2/shared-types/v1';
import { unprocessable } from '@common/v1/problem';
import { StoredPlan, StoredPlanState } from '@database/schemas/v1/plans.schema';

/**
 * What a plan's steps are, and how the clock on one is read. Nothing here
 * touches the database, so the engine, a transition and a replaced plan all
 * compute it the same way.
 */

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

/**
 * A plan that is not running. It keeps its steps and stands at the first one,
 * which is where starting it again picks it up.
 *
 * `completed` is the plan that ran out of steps without looping; `stopped` is
 * the one a person put away, which is what "Stop recipe" on the plan screen has
 * always left behind and what the migration writes for a recipe whose
 * `activeSince` was zero.
 */
const atRest = (status: 'completed' | 'stopped'): StoredPlanState => ({
  status,
  activeStepIndex: 0,
  stepStartedAt: null,
  pausedElapsedMs: 0,
  pauseReason: null,
  lastAppliedAt: null,
  confirmationNotifiedAt: null,
});

export const completed = (): StoredPlanState => atRest('completed');

export const stopped = (): StoredPlanState => atRest('stopped');

/**
 * The steps as they are stored, from the steps a client wrote.
 *
 * A step keeps the id it was answered with, because that id is how the plan
 * finds the step it is standing on again once the array has been edited - a step
 * inserted above the running one moves it down the list, and the plan has to
 * move with it rather than staying on a number. A step that is new to the plan
 * carries none and gets one here.
 *
 * A step that names no stage and no preset says nothing about the grow, which is
 * what a recipe of nothing but climates says at every step. That is written down
 * as `null` rather than left out, so the stored step and the step that is
 * answered carry the same keys as every other one - and a step that said nothing
 * before a person re-saved it says nothing after.
 *
 * Two steps under one id would make that lookup pick whichever came first, so a
 * plan that carries one is refused rather than stored and misread later.
 */
export const stepsOf = (steps: PlanStepInput[]): PlanStep[] => {
  const given = steps.filter(step => step.id !== undefined).map(step => step.id);
  if (new Set(given).size !== given.length) {
    throw unprocessable('duplicate_step_id', 'Two steps of this plan carry the same id.', [
      { field: 'steps', code: 'duplicate', detail: 'A step keeps its own id; a new step carries none.' },
    ]);
  }

  return steps.map(step => ({ ...step, id: step.id ?? uuidv4(), stage: step.stage ?? null, preset: step.preset ?? null }));
};

/**
 * Where a plan stands once its steps have been replaced.
 *
 * The step the device is being run by is looked up by its id, so an edit that
 * only inserts or reorders steps leaves the running step running, with the time
 * it has already served. A step that the edit removed leaves nothing to
 * continue, so the plan takes the step that stands at its place now and starts
 * that one's clock; a plan with no steps at all has nothing to run and stops.
 *
 * `lastAppliedAt` is cleared either way. The device is running what the plan
 * said before the edit, and the engine would otherwise leave it there for up to
 * an hour.
 */
export const positionIn = (state: StoredPlanState, before: PlanStep[], after: PlanStep[], now: Date): StoredPlanState => {
  if (after.length === 0) return stopped();

  const standingOn = before[state.activeStepIndex]?.id ?? null;
  const kept = standingOn === null ? -1 : after.findIndex(step => step.id === standingOn);
  if (kept >= 0) return { ...state, activeStepIndex: kept, lastAppliedAt: null };

  // Nothing of the removed step's clock carries over to the one standing at its
  // place, and a confirmation it had asked for was about a step that is gone.
  return {
    ...state,
    activeStepIndex: Math.min(Math.max(state.activeStepIndex, 0), after.length - 1),
    stepStartedAt: state.status === 'running' ? now : null,
    pausedElapsedMs: 0,
    lastAppliedAt: null,
    confirmationNotifiedAt: null,
  };
};
