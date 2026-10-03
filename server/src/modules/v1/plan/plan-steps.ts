import { v4 as uuidv4 } from 'uuid';
import type { DeviceConfiguration, DurationUnit, PlanStep, PlanStepInput, StepDuration } from '@fg2/shared-types/v1';
import { lightWindowOf, lightWindowTimes } from '@fg2/shared-types/v1-schemas/day-night.js';
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
  confirmationAskedAt: null,
  confirmationAskTriedAt: null,
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
  confirmationAskedAt: null,
  confirmationAskTriedAt: null,
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

  // A step written with both times of day sets the hour the light comes on and
  // the hours it stays on; it is stored as those, so the night is worked out
  // where every window is.
  return steps.map(step =>
    withWindowAsHours(
      {
        ...step,
        id: step.id ?? uuidv4(),
        stage: step.stage ?? null,
        preset: step.preset ?? null,
        lightHours: step.lightHours ?? null,
      },
      true,
    ),
  );
};

/** A step as the contract answers it: one stored before it could name light hours names none. */
export const answeredStep = (step: PlanStep): PlanStep => ({ ...step, lightHours: step.lightHours ?? null });

/** Whether a step changes anything on the device: figures of its own, light hours, or a stage, which decides the work mode. */
export const stepWrites = (step: PlanStep): boolean =>
  Object.keys(step.settings ?? {}).length > 0 || (step.lightHours ?? null) !== null || step.stage !== null;

const sectionOf = (document: DeviceConfiguration | null, key: string): Record<string, unknown> => {
  const value = document?.[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * What a step sends, merged into the device's document like every other step:
 * its own settings, and its light hours as the two times of day the firmware
 * keeps, written the one way every window is written (`lightWindowTimes`).
 *
 * The light keeps the hour it comes on - the device's, which is the grower's
 * to move under the targets without the plan putting it back an hour later -
 * unless the step names one of its own in `daynight.day`. Only a step that
 * does sets the time; the rest leave it where it is.
 */
export const settingsSent = (step: PlanStep, current: DeviceConfiguration | null): DeviceConfiguration => {
  const hours = step.lightHours ?? null;
  if (hours === null) return step.settings;

  const own = sectionOf(step.settings, 'daynight');
  const device = sectionOf(current, 'daynight');
  const lightsOn = numberOrNull(own.day) ?? lightWindowOf(numberOrNull(device.day), numberOrNull(device.night)).lightsOn;
  const { night: _unused, ...kept } = own;

  return { ...step.settings, daynight: { ...kept, ...lightWindowTimes({ lightsOn, lightHours: hours }) } };
};

/**
 * A step's settings with a whole light window carried in them turned into the
 * hours the step means, where it names none: both times of day sent as they
 * stand would put the light-on hour back every hour the plan re-sends its step.
 * The hour itself is kept where `keepTime` says the recipe sets it.
 */
export const withWindowAsHours = <T extends Pick<PlanStep, 'settings' | 'lightHours'>>(step: T, keepTime: boolean): T => {
  const own = sectionOf(step.settings, 'daynight');
  const day = numberOrNull(own.day);
  const night = numberOrNull(own.night);
  if (day === null || night === null) return step;

  const { day: _day, night: _night, ...rest } = own;
  const daynight = keepTime ? { ...rest, day: lightWindowOf(day, night).lightsOn } : rest;
  const { daynight: _old, ...others } = step.settings;
  const settings = Object.keys(daynight).length > 0 ? { ...others, daynight } : others;

  return { ...step, settings, lightHours: step.lightHours ?? lightWindowOf(day, night).lightHours };
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
    confirmationAskedAt: null,
    confirmationAskTriedAt: null,
  };
};
