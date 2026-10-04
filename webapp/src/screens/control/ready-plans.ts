import type { Device, GrowthStage, PlanNotify } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { CLIMATE_FIGURES, keyedStep, withFigure, type PlanDraft, type StepDraft } from './plan-edit';

/**
 * The two plans a fridge grower can start with one tap: photoperiod seeds,
 * about sixteen weeks, and autoflowers, about eleven. Each is the whole grow -
 * seedling, growth, flower, late flower and drying - with the climate of the
 * shared preset table, the light hours of each stage and a question where a
 * person has to look before the plan goes on: is it time for 12/12, are the
 * trichomes ready, is the drying done.
 *
 * They are offered as templates rather than kept as rows, because what a step
 * writes depends on the hardware it is opened for (no CO2 figure where no sensor
 * measures it) and its words on the language the grower reads; opening one
 * fills the editor like any template, and nothing is written before Save.
 */

interface ReadyStep {
  /** `growPresets.stages.*`, the step's name. */
  name: string;
  stage: GrowthStage;
  preset: string | null;
  days: number;
  /** Where the stage's own light hours are not this plan's: an autoflower never gets the 12/12 flip. */
  lightHours?: number;
  /** `growPresets.confirmations.*`, what the step asks before the plan goes on. */
  asks?: string;
}

export interface ReadyPlan {
  id: 'photoperiod' | 'autoflower';
  steps: readonly ReadyStep[];
}

const AUTOFLOWER_LIGHT = 18;

export const READY_PLANS: readonly ReadyPlan[] = [
  {
    id: 'photoperiod',
    steps: [
      { name: 'seedling', stage: 'seedling', preset: null, days: 14 },
      { name: 'vegetative', stage: 'vegetative', preset: null, days: 28, asks: 'startFlowering' },
      { name: 'flowering', stage: 'flowering', preset: null, days: 42 },
      { name: 'lateFlowering', stage: 'flowering', preset: 'late_flowering', days: 21, asks: 'harvest' },
      { name: 'drying', stage: 'drying', preset: null, days: 10, asks: 'dryingDone' },
    ],
  },
  {
    id: 'autoflower',
    steps: [
      { name: 'seedling', stage: 'seedling', preset: null, days: 10, lightHours: AUTOFLOWER_LIGHT },
      { name: 'vegetative', stage: 'vegetative', preset: 'autoflower', days: 18, lightHours: AUTOFLOWER_LIGHT },
      { name: 'flowering', stage: 'flowering', preset: 'autoflower', days: 28, lightHours: AUTOFLOWER_LIGHT },
      { name: 'lateFlowering', stage: 'flowering', preset: 'late_flowering', days: 14, lightHours: AUTOFLOWER_LIGHT, asks: 'harvest' },
      { name: 'drying', stage: 'drying', preset: null, days: 10, asks: 'dryingDone' },
    ],
  },
];

/** Only a fridge is offered them: their figures are a fridge's, and a tent is set up too differently for one plan to fit. */
export const offersReadyPlans = (device: Device): boolean => device.type === 'fridge';

/** How many weeks a plan runs, rounded the way its description says it. */
export const weeksOf = (plan: ReadyPlan): number => Math.round(plan.steps.reduce((sum, step) => sum + step.days, 0) / 7);

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One step as the editor holds it: the climate figures of the preset table for
 * its stage, and its light hours. A step whose stage is kept dark - drying -
 * leaves the photoperiod as it is, because the drying mode runs no day at all.
 */
const stepOf = (t: Translate, step: ReadyStep): StepDraft => {
  const climate = climatePreset(step.stage, step.preset);
  const values: Record<string, number | null | undefined> = {
    dayTemperature: climate?.dayTemperature,
    dayHumidity: climate?.dayHumidity,
    nightTemperature: climate?.nightTemperature,
    nightHumidity: climate?.nightHumidity,
    co2: climate?.co2,
    light: climate?.lightLimit,
  };

  return keyedStep({
    name: t(`growPresets.stages.${step.name}`),
    stage: step.stage,
    preset: step.preset,
    duration: { value: step.days, unit: 'days' },
    settings: CLIMATE_FIGURES.reduce((settings, figure) => withFigure(settings, figure, values[figure.key] ?? null), {}),
    lightHours: step.lightHours ?? climate?.lightHours ?? null,
    waitForConfirmation: step.asks !== undefined,
    confirmationMessage: step.asks ? t(`growPresets.confirmations.${step.asks}`) : null,
    germinationChoices: null,
  });
};

/** The plan, as the editor opens it: named in the reader's language, every step new to it. */
export const readyDraft = (t: Translate, plan: ReadyPlan, notify: PlanNotify): PlanDraft => ({
  name: t(`growPresets.plans.${plan.id}.name`),
  templateId: null,
  loop: false,
  notify,
  steps: plan.steps.map(step => stepOf(t, step)),
});
