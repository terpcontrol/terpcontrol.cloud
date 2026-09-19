import type { DateTime } from 'luxon';
import type { DeviceConfiguration, GrowthStage, Plan, PlanNotify, PlanReplace, PlanStep, StepDuration } from '@fg2/shared-types/v1';
import { elapsedMs } from './plan-clock';

/**
 * The recipe while it is being written, and what saving it would do to the tent
 * that is being run by it.
 *
 * A step's id is the whole reason an edit can be promised anything: the server
 * finds the step the device is standing on again by that id, so a step inserted
 * above it moves the plan down the list with it, and a step that the edit
 * removed leaves nothing to continue. A step that is new to the plan therefore
 * carries no id at all and is given one when it is saved - which is why the
 * draft keeps a key of its own to draw the list by.
 *
 * What is worked out here is the same lookup `positionIn` does on the server.
 * It is worked out before the save rather than reported after it, because "the
 * step it is on starts again from zero" is not something to find out from a
 * clock that has gone back to nothing.
 */

export interface StepDraft {
  /** What the list is drawn by while it is being edited; a step that is new to the plan has no id to use. */
  key: string;
  /** Absent for a step the plan has never had. The server fills it in, and the step keeps it from then on. */
  id?: string;
  name: string;
  stage: GrowthStage | null;
  preset: string | null;
  duration: StepDuration;
  settings: DeviceConfiguration;
  waitForConfirmation: boolean;
  confirmationMessage: string | null;
}

export interface PlanDraft {
  name: string;
  templateId: string | null;
  loop: boolean;
  notify: PlanNotify;
  steps: StepDraft[];
}

let drawn = 0;

const keyed = (step: Omit<StepDraft, 'key'>): StepDraft => ({ ...step, key: `draft-${++drawn}` });

export const draftOf = (plan: Plan): PlanDraft => ({
  name: plan.name,
  templateId: plan.templateId,
  loop: plan.loop,
  notify: { ...plan.notify },
  steps: plan.steps.map(step => keyed({ ...step })),
});

/**
 * The steps of a template, as steps this plan has never had. The ids are left
 * behind on purpose: they belong to the template, and a plan that shared them
 * would look to a later edit like a plan that had always carried these steps.
 */
export const draftFromTemplate = (steps: PlanStep[], name: string, templateId: string | null, notify: PlanNotify): PlanDraft => ({
  name,
  templateId,
  loop: false,
  notify,
  steps: steps.map(({ id: _id, ...step }) => keyed({ ...step })),
});

export const emptyDraft = (name: string, notify: PlanNotify): PlanDraft => ({ name, templateId: null, loop: false, notify, steps: [] });

export const newStep = (name: string): StepDraft =>
  keyed({
    name,
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'weeks' },
    settings: {},
    waitForConfirmation: false,
    confirmationMessage: null,
  });

/** The draft as the route takes it. A step that is new goes without an id, which is what asks for one. */
export const replaceBody = (draft: PlanDraft): PlanReplace => ({
  templateId: draft.templateId,
  name: draft.name,
  loop: draft.loop,
  notify: draft.notify,
  steps: draft.steps.map(({ key: _key, ...step }) => step),
});

/** A step one place up or down. Out of the list at either end is no move at all rather than a wrap-around. */
export const moveStep = (steps: StepDraft[], index: number, by: -1 | 1): StepDraft[] => {
  const to = index + by;
  if (to < 0 || to >= steps.length) return steps;

  const moved = [...steps];
  [moved[index], moved[to]] = [moved[to], moved[index]];

  return moved;
};

/* ------------------------------------------------------------ the settings */

/**
 * The climate a step writes, as the device's own configuration document states
 * it. The paths are the firmware's and are the ones the server reads a setpoint
 * and a phase's target band from; the figures behind them are not copied to this
 * side, because the one table of what a stage is worth lives on the server.
 */
export interface Figure {
  key: string;
  section: string;
  field: string;
}

export const CLIMATE_FIGURES: Figure[] = [
  { key: 'dayTemperature', section: 'day', field: 'temperature' },
  { key: 'dayHumidity', section: 'day', field: 'humidity' },
  { key: 'nightTemperature', section: 'night', field: 'temperature' },
  { key: 'nightHumidity', section: 'night', field: 'humidity' },
  { key: 'co2', section: 'co2', field: 'target' },
  { key: 'light', section: 'lights', field: 'limit' },
];

const CLIMATE_SECTIONS = [...new Set(CLIMATE_FIGURES.map(figure => figure.section))];

const sectionOf = (settings: DeviceConfiguration, name: string): Record<string, unknown> | null => {
  const value = settings[name];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

/**
 * One figure of a step. A device that reports its document nested and a client
 * that once wrote it flat mean the same thing, so both are read - exactly as the
 * server reads a setpoint out of the same document.
 */
export const figureOf = (settings: DeviceConfiguration, figure: Figure): number | null => {
  const nested = sectionOf(settings, figure.section)?.[figure.field];
  const value = nested ?? settings[`${figure.section}.${figure.field}`];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * A figure put into, or taken out of, the settings a step carries.
 *
 * The merge on the way to the device is by top-level key, so a step that carries
 * a section writes that whole section over the one the controller is running.
 * That is why a section this step does not have yet is started from what the
 * controller runs now rather than from nothing: everything else in it - the
 * heating behaviour, the dehumidifier's timing - is the tent's own tuning, and a
 * step that quietly dropped it would be a change nobody asked for.
 *
 * Clearing the last figure of a section removes the section, which is the step
 * saying it writes nothing there at all.
 */
export const withFigure = (
  settings: DeviceConfiguration,
  figure: Figure,
  value: number | null,
  runningNow: DeviceConfiguration | null,
): DeviceConfiguration => {
  const flat = `${figure.section}.${figure.field}`;
  const section = { ...(sectionOf(settings, figure.section) ?? sectionOf(runningNow ?? {}, figure.section) ?? {}) };
  const next: DeviceConfiguration = { ...settings };
  delete next[flat];

  if (value === null) {
    delete section[figure.field];
    const others = CLIMATE_FIGURES.filter(one => one.section === figure.section && one.key !== figure.key);
    const stillWritten = others.some(one => figureOf({ [figure.section]: section }, one) !== null);

    if (!stillWritten) delete next[figure.section];
    else next[figure.section] = section;

    return next;
  }

  next[figure.section] = { ...section, [figure.field]: value };
  return next;
};

/** What a step writes besides the climate - a migrated recipe carries whole documents - said rather than silently kept. */
export const otherSections = (settings: DeviceConfiguration): string[] => Object.keys(settings).filter(key => !CLIMATE_SECTIONS.includes(key));

export const writesNothing = (settings: DeviceConfiguration): boolean => Object.keys(settings).length === 0;

/* --------------------------------------------------- what a save would move */

export interface PlanEditEffect {
  /** The plan is neither running nor paused, so an edit moves nothing: starting it begins at the first step. */
  atRest: boolean;
  /** The step the device is on survives, with the time it has already served, at this place in the list. */
  keeps: { name: string; from: number; to: number; servedMs: number; relength: boolean } | null;
  /** The step the device is on is gone from the list, so the step standing at its place starts from zero. */
  restarts: { gone: string; starts: string; at: number } | null;
  /** Nothing is left to run, so the plan stops and stands at rest. */
  empties: boolean;
  /** The step is sent to the controller again on the next pass rather than within the hour. */
  resends: boolean;
}

/**
 * What saving this draft would do to the tent being run by the plan. The step
 * the device is standing on is looked up by its id, which is the same lookup the
 * server does when it stores the new steps.
 */
export const editEffect = (plan: Plan, steps: StepDraft[], now: DateTime): PlanEditEffect => {
  const nothing: PlanEditEffect = { atRest: false, keeps: null, restarts: null, empties: false, resends: false };
  const running = plan.state.status === 'running' || plan.state.status === 'paused';
  if (!running) return { ...nothing, atRest: true };
  if (steps.length === 0) return { ...nothing, empties: true };

  const from = plan.state.activeStepIndex;
  const standing = plan.steps[from] ?? null;
  const kept = standing === null ? -1 : steps.findIndex(step => step.id === standing.id);

  if (kept >= 0) {
    const relength =
      standing !== null && (standing.duration.value !== steps[kept].duration.value || standing.duration.unit !== steps[kept].duration.unit);
    return {
      ...nothing,
      keeps: { name: steps[kept].name, from: from + 1, to: kept + 1, servedMs: elapsedMs(plan.state, now), relength },
      resends: plan.state.status === 'running',
    };
  }

  const at = Math.min(Math.max(from, 0), steps.length - 1);
  return {
    ...nothing,
    restarts: { gone: standing?.name ?? '', starts: steps[at].name, at: at + 1 },
    resends: plan.state.status === 'running',
  };
};
