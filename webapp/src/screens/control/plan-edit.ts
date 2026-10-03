import type { DateTime } from 'luxon';
import type { Device, DeviceConfiguration, GrowthStage, Plan, PlanNotify, PlanReplace, PlanStep, StepDuration } from '@fg2/shared-types/v1';
import { lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { hasCo2Sensor } from '@/ui/climate-hardware';
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
  /** How long the light is on while the step runs; null leaves the photoperiod as it is. */
  lightHours: number | null;
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

/** A step as the editor holds it, with a key of its own to draw the list by. */
export const keyedStep = (step: Omit<StepDraft, 'key'>): StepDraft => ({ ...step, key: `draft-${++drawn}` });

export const draftOf = (plan: Plan): PlanDraft => ({
  name: plan.name,
  templateId: plan.templateId,
  loop: plan.loop,
  notify: { ...plan.notify },
  steps: plan.steps.map(step => keyedStep({ ...step, lightHours: step.lightHours ?? null })),
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
  steps: steps.map(({ id: _id, ...step }) => keyedStep({ ...step, lightHours: step.lightHours ?? null })),
});

export const emptyDraft = (name: string, notify: PlanNotify): PlanDraft => ({ name, templateId: null, loop: false, notify, steps: [] });

export const newStep = (name: string): StepDraft =>
  keyedStep({
    name,
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'weeks' },
    settings: {},
    lightHours: null,
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

/** The light hours a step may name: the targets page's own range. */
export const LIGHT_HOURS = { min: 0, max: 24 } as const;

/** Whether every step names light hours the server takes, or none at all. */
export const lightHoursFit = (steps: StepDraft[]): boolean =>
  steps.every(step => step.lightHours === null || (step.lightHours >= LIGHT_HOURS.min && step.lightHours <= LIGHT_HOURS.max));

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

/**
 * The figures a step may write to this controller.
 *
 * A controller that reports no CO2 sensor is one the firmware holds at a target
 * of zero: it forces `co2.target` to nothing as it reads a document, whatever
 * the document says. A step offering the figure would therefore be offering to
 * store a number nobody runs, on the same tab whose manual targets page draws
 * that row dead and says what it needs.
 */
export const figuresFor = (device: Device, stage: GrowthStage | null = null): Figure[] =>
  (stage === 'drying' ? DRYING_FIGURES : CLIMATE_FIGURES).filter(figure => hasCo2Sensor(device) || figure.section !== 'co2');

/**
 * What a drying step holds: the night's temperature and humidity, round the
 * clock in the dark. A step into drying switches the device into its drying
 * mode, which knows no day - no light, no CO2 - so the day's figures, the light
 * limit and the light hours would be written for nothing.
 */
const DRYING_FIGURES: Figure[] = CLIMATE_FIGURES.filter(figure => figure.section === 'night');

/** A step's settings with the figures its stage does not hold taken out, so that it writes what it shows. */
export const heldByStage = (step: StepDraft, stage: GrowthStage | null): Pick<StepDraft, 'settings' | 'lightHours'> =>
  stage === 'drying'
    ? {
        settings: CLIMATE_FIGURES.filter(figure => !DRYING_FIGURES.includes(figure)).reduce(
          (settings, figure) => withFigure(settings, figure, null),
          step.settings,
        ),
        lightHours: null,
      }
    : { settings: step.settings, lightHours: step.lightHours };

/**
 * A draft with every figure this controller cannot run taken out of its steps,
 * which is what opening the editor for one hands to the fields.
 *
 * Hiding the row would leave a plan carrying a CO2 target that goes on being
 * published and stored while nothing on the screen says so; taking it out means
 * the step writes what the step shows. The section goes with the last figure in
 * it, so a step that asked for nothing else says it writes nothing.
 */
export const asWritableBy = (draft: PlanDraft, device: Device): PlanDraft => {
  const dropped = CLIMATE_FIGURES.filter(figure => !figuresFor(device).includes(figure));
  if (dropped.length === 0) return draft;

  return {
    ...draft,
    steps: draft.steps.map(step => ({
      ...step,
      settings: dropped.reduce((settings, figure) => withFigure(settings, figure, null), step.settings),
    })),
  };
};

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
 * The server merges a step into each section the controller is running, so a
 * step carries the figures it writes and nothing else: the rest of the section -
 * the other figures, the heating behaviour, the dehumidifier's timing - stays
 * what the controller has. A figure left empty is therefore one the controller
 * keeps, and clearing the last figure of a section removes the section, which
 * is the step saying it writes nothing there at all.
 */
export const withFigure = (settings: DeviceConfiguration, figure: Figure, value: number | null): DeviceConfiguration => {
  const flat = `${figure.section}.${figure.field}`;
  const section = { ...(sectionOf(settings, figure.section) ?? {}) };
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

/* -------------------------------------------------------------- the light */

const LIGHTS_ON: Figure = { key: 'lightsOn', section: 'daynight', field: 'day' };
const LIGHTS_OFF: Figure = { key: 'lightsOff', section: 'daynight', field: 'night' };

/**
 * The hour the light comes on that a step brings with it, in seconds past
 * midnight UTC, or null where it keeps the device's. A recipe migrated from
 * the old app carries two fixed times of day in its settings, and the engine
 * sends them every hour: the step then decides when the light comes on, not
 * the targets page.
 */
export const stepLightsOn = (settings: DeviceConfiguration): number | null => figureOf(settings, LIGHTS_ON);

/** How long the light is on while a step runs: its light hours, or the hours its own two times make; null where it leaves them. */
export const stepLightHours = (step: Pick<StepDraft, 'settings' | 'lightHours'>): number | null => {
  if (step.lightHours !== null && step.lightHours !== undefined) return step.lightHours;
  const on = figureOf(step.settings, LIGHTS_ON);
  const off = figureOf(step.settings, LIGHTS_OFF);
  return on !== null && off !== null ? lightWindowOf(on, off).lightHours : null;
};

/**
 * A step's own light-on time moved, keeping the hours it lights for: the
 * server puts a step's light hours after its own time where it has one, and a
 * step that names no hours sends its two times as they are, so the second one
 * moves with the first.
 */
export const withStepLightsOn = (step: StepDraft, seconds: number): Partial<StepDraft> => {
  const daynight = { ...((step.settings.daynight as Record<string, unknown> | undefined) ?? {}) };
  const off = figureOf(step.settings, LIGHTS_OFF);
  const on = figureOf(step.settings, LIGHTS_ON);
  daynight.day = seconds;
  if (step.lightHours === null && off !== null && on !== null) daynight.night = (((off + seconds - on) % 86400) + 86400) % 86400;
  const settings: DeviceConfiguration = { ...step.settings, daynight };
  delete settings['daynight.day'];
  delete settings['daynight.night'];
  return { settings };
};

/**
 * A step without times of its own: the light then comes on at the device's
 * hour, as a step written in this app does, for as long as the step's times
 * made it - so taking the time away changes when the light comes on and
 * nothing else.
 */
export const withoutStepLightsOn = (step: StepDraft): Partial<StepDraft> => {
  const hours = stepLightHours(step);
  const settings: DeviceConfiguration = { ...step.settings };
  const daynight = { ...((settings.daynight as Record<string, unknown> | undefined) ?? {}) };
  delete daynight.day;
  delete daynight.night;
  delete settings['daynight.day'];
  delete settings['daynight.night'];
  if (Object.keys(daynight).length > 0) settings.daynight = daynight;
  else delete settings.daynight;
  return { settings, lightHours: hours === null ? step.lightHours : Math.round(hours * 10) / 10 };
};

/** Whether a section carries nothing but the light's two times, which the light hours field shows rather than names. */
const onlyTimes = (section: unknown): boolean =>
  typeof section === 'object' && section !== null && Object.keys(section).every(key => key === 'day' || key === 'night');

/** What a step writes besides the climate - a migrated recipe carries whole documents - said rather than silently kept. */
export const otherSections = (settings: DeviceConfiguration): string[] =>
  Object.keys(settings).filter(key => !CLIMATE_SECTIONS.includes(key) && !(key === 'daynight' && onlyTimes(settings[key])));

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
