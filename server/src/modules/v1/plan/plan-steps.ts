import { v4 as uuidv4 } from 'uuid';
import type { DeviceConfiguration, PlanStep, PlanStepInput, ProblemError } from '@fg2/shared-types/v1';
import { finiteOrNull, sectionOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { lightWindowOf, lightWindowTimes } from '@fg2/shared-types/v1-schemas/day-night.js';
import { unprocessable } from '@common/v1/problem';
import { StoredPlanState } from '@database/schemas/v1/plans.schema';
import { DocumentFigures, figureRefusals } from '@modules/device-protocol/document-figures';

/**
 * What a plan's steps are, and the state a plan stands in. Nothing here touches
 * the database, so the engine, a transition and a replaced plan all compute it
 * the same way; the clock on a step is the contract's (`plan-clock.ts`).
 */

/**
 * A plan entering a state. What a step asked and what it applied are the step's
 * own, so entering one forgets both rather than inheriting them from the step
 * before.
 */
const stateOf = (status: StoredPlanState['status'], activeStepIndex: number, stepStartedAt: Date | null): StoredPlanState => ({
  status,
  activeStepIndex,
  stepStartedAt,
  pausedElapsedMs: 0,
  pauseReason: null,
  lastAppliedAt: null,
  confirmationNotifiedAt: null,
  confirmationAskedAt: null,
  confirmationAskTriedAt: null,
});

/** The state a step runs in from now. */
export const running = (activeStepIndex: number, now: Date): StoredPlanState => stateOf('running', activeStepIndex, now);

/**
 * A plan that is not running. It keeps its steps and stands at the first one,
 * which is where starting it again picks it up.
 *
 * `completed` is the plan that ran out of steps without looping; `stopped` is
 * the one a person put away, which is what "Stop recipe" on the plan screen has
 * always left behind and what the migration writes for a recipe whose
 * `activeSince` was zero.
 */
export const completed = (): StoredPlanState => stateOf('completed', 0, null);

export const stopped = (): StoredPlanState => stateOf('stopped', 0, null);

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
 * What germination does about the humidity is kept on a germination step
 * alone, and `null` on the rest: a step that does not germinate has nothing to
 * say about it, and a choice carried there would be put on the device as the
 * one for its next germination.
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
        germinationChoices: step.stage === 'germination' ? (step.germinationChoices ?? null) : null,
      },
      true,
    ),
  );
};

/**
 * What a firmware would refuse in the steps a client wrote, each figure held to
 * it as a document saved by hand is (`figureRefusals`) and refused with the step
 * and the place named - `steps.0.settings.night.temperature`. A figure the same
 * step already carried is not held to its range again: a recipe migrated from
 * the old app keeps what it was written with.
 */
export const stepRefusals = (type: string, steps: PlanStepInput[], earlier: readonly PlanStep[] | null, figures?: DocumentFigures): ProblemError[] =>
  steps.flatMap((step, index) =>
    figureRefusals(type, step.settings, {
      field: `steps.${index}.settings`,
      figures,
      stored: earlier?.find(previous => step.id !== undefined && previous.id === step.id)?.settings ?? null,
    }),
  );

/** A step as the contract answers it: one stored before it could name light hours or germination choices names none. */
export const answeredStep = (step: PlanStep): PlanStep => ({
  ...step,
  lightHours: step.lightHours ?? null,
  germinationChoices: step.germinationChoices ?? null,
});

/** Whether a step changes anything on the device: figures of its own, light hours, or a stage, which decides the work mode. */
export const stepWrites = (step: PlanStep): boolean =>
  Object.keys(step.settings ?? {}).length > 0 || (step.lightHours ?? null) !== null || step.stage !== null;

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

  const own = sectionOf(step.settings, 'daynight') ?? {};
  const device = sectionOf(current, 'daynight') ?? {};
  const lightsOn = finiteOrNull(own.day) ?? lightWindowOf(finiteOrNull(device.day), finiteOrNull(device.night)).lightsOn;
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
  const own = sectionOf(step.settings, 'daynight') ?? {};
  const day = finiteOrNull(own.day);
  const night = finiteOrNull(own.night);
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
