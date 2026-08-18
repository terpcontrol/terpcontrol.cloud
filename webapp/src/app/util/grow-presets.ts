import { DiaryLifecycleStage, Recipe, RecipeStep } from '@fg2/shared-types';
import { parseSocketRoles } from './socket-info';

export type GrowStagePresetId = 'seedling' | 'vegetative' | 'flowering' | 'late_flowering' | 'drying';

export interface GrowStagePreset {
  id: GrowStagePresetId;
  stage: DiaryLifecycleStage;
  icon: string;
  workmode: 'small' | 'dry';
  dayTemperature: number;
  nightTemperature: number;
  dayHumidity: number;
  nightHumidity: number;
  /** Hours of light per day; unused in 'dry' workmode. */
  lightHours: number;
  lightLimit: number;
  /** CO2 target with a CO2 setup vs. ambient fallback that keeps a valve shut. */
  co2Enriched: number;
  co2Ambient: number;
  vpdRange: [number, number];
  showInPicker: boolean;
}

/**
 * Recommended climate targets per grow stage. Values are written into the
 * existing device configuration fields only — no preset id is ever stored,
 * because the firmware strips unknown keys when it echoes its config back.
 * Drying matches the marketed window (16-20°C / 55-60% rH).
 */
export const GROW_STAGE_PRESETS: GrowStagePreset[] = [
  {
    id: 'seedling',
    stage: 'seedling',
    icon: 'assets/icon/presets/seedling.svg',
    workmode: 'small',
    dayTemperature: 24,
    nightTemperature: 21,
    dayHumidity: 70,
    nightHumidity: 65,
    lightHours: 18,
    lightLimit: 40,
    co2Enriched: 400,
    co2Ambient: 400,
    vpdRange: [0.4, 0.8],
    showInPicker: true,
  },
  {
    id: 'vegetative',
    stage: 'vegetative',
    icon: 'assets/icon/presets/vegetation.svg',
    workmode: 'small',
    dayTemperature: 26,
    nightTemperature: 22,
    dayHumidity: 62,
    nightHumidity: 58,
    lightHours: 18,
    lightLimit: 80,
    co2Enriched: 900,
    co2Ambient: 400,
    vpdRange: [0.8, 1.1],
    showInPicker: true,
  },
  {
    id: 'flowering',
    stage: 'flowering',
    icon: 'assets/icon/presets/flower.svg',
    workmode: 'small',
    dayTemperature: 25,
    nightTemperature: 20,
    dayHumidity: 50,
    nightHumidity: 50,
    lightHours: 12,
    lightLimit: 100,
    co2Enriched: 1000,
    co2Ambient: 400,
    vpdRange: [1.2, 1.5],
    showInPicker: true,
  },
  {
    id: 'late_flowering',
    stage: 'flowering',
    icon: 'assets/icon/presets/flower-late.svg',
    workmode: 'small',
    dayTemperature: 24,
    nightTemperature: 18,
    dayHumidity: 45,
    nightHumidity: 45,
    lightHours: 12,
    lightLimit: 100,
    co2Enriched: 400,
    co2Ambient: 400,
    vpdRange: [1.3, 1.6],
    showInPicker: true,
  },
  {
    id: 'drying',
    stage: 'drying',
    icon: 'assets/icon/presets/drying.svg',
    workmode: 'dry',
    dayTemperature: 18,
    nightTemperature: 18,
    dayHumidity: 58,
    nightHumidity: 58,
    lightHours: 0,
    lightLimit: 0,
    co2Enriched: 400,
    co2Ambient: 400,
    vpdRange: [0.9, 1.3],
    showInPicker: true,
  },
];

export function getStagePreset(id: GrowStagePresetId): GrowStagePreset {
  const preset = GROW_STAGE_PRESETS.find(p => p.id === id);
  if (!preset) {
    throw new Error(`Unknown grow stage preset: ${id}`);
  }
  return preset;
}

/**
 * Whether the device has a CO2 sensor: controllers report it via hardware-info
 * ('off' when the SCD4x is absent), fridges have it built in. Nothing is asked
 * of the user anymore.
 */
export function deviceHasCo2(device: { device_type?: string; hardwareInfo?: Record<string, string> } | null | undefined): boolean {
  if (!device) {
    return true;
  }
  if (device.device_type === 'controller') {
    return device.hardwareInfo?.['co2'] !== 'off';
  }
  return true;
}

export type ControlCapability = 'full' | 'light_only' | 'monitor';

const CLIMATE_SOCKET_ROLES = ['dehumidifier', 'heater', 'co2'];
const LIGHT_SOCKET_ROLES = ['light', 'secondary_light'];

/**
 * What the device can actually switch, derived from its hardware instead of a
 * stored setting: fridges have built-in actuators, controllers act through
 * their paired smart sockets (reported as `hardwareInfo.sockets`). A
 * controller without an up-to-date sockets report (older firmware) is treated
 * as fully controlling so nothing gets hidden by mistake.
 */
export function deviceControlCapability(
  device: { device_type?: string; hardwareInfo?: Record<string, string> } | null | undefined,
): ControlCapability {
  if (!device || device.device_type !== 'controller') {
    return 'full';
  }
  const csv = device.hardwareInfo?.['sockets'];
  if (csv === undefined) {
    return 'full';
  }
  const roles = parseSocketRoles(csv);
  if (roles.some(role => CLIMATE_SOCKET_ROLES.includes(role))) {
    return 'full';
  }
  if (roles.some(role => LIGHT_SOCKET_ROLES.includes(role))) {
    return 'light_only';
  }
  return 'monitor';
}

const TEMPERATURE_TOLERANCE = 0.5;
const HUMIDITY_TOLERANCE = 2;
const LIGHT_LIMIT_TOLERANCE = 5;
const PHOTOPERIOD_TOLERANCE_SECONDS = 60;

const near = (a: any, b: number, tolerance: number): boolean => {
  const value = Number(a);
  return Number.isFinite(value) && Math.abs(value - b) <= tolerance;
};

/**
 * Applies a stage preset onto a copy of the given device configuration.
 * Only fields the firmware round-trips are written; hardware tuning (heater
 * behavior, fans, dehumidify timing) is deliberately left untouched so it
 * survives preset switches. The photoperiod keeps the user's daybreak time
 * and moves nightfall accordingly.
 */
export function applyStagePreset(settings: any, presetId: GrowStagePresetId, options: { hasCo2: boolean; lightHours?: number }): any {
  const preset = getStagePreset(presetId);
  const result = JSON.parse(JSON.stringify(settings ?? {}));
  if (!preset) {
    return result;
  }

  result.workmode = preset.workmode;
  result.day = result.day ?? {};
  result.night = result.night ?? {};

  if (preset.workmode === 'dry') {
    result.day.temperature = preset.dayTemperature;
    result.day.humidity = preset.dayHumidity;
    result.night.temperature = preset.nightTemperature;
    result.night.humidity = preset.nightHumidity;
    return result;
  }

  result.daynight = result.daynight ?? {};
  result.lights = result.lights ?? {};
  result.co2 = result.co2 ?? {};

  result.day.temperature = preset.dayTemperature;
  result.day.humidity = preset.dayHumidity;
  result.night.temperature = preset.nightTemperature;
  result.night.humidity = preset.nightHumidity;

  const lightHours = options.lightHours ?? preset.lightHours;
  const daybreak = Number.isFinite(Number(result.daynight.day)) ? Number(result.daynight.day) : 6 * 3600;
  result.daynight.day = daybreak;
  result.daynight.night = (daybreak + lightHours * 3600) % 86400;
  if (result.daynight.floating) {
    result.daynight.light_duration = Math.min(lightHours, Number(result.daynight.day_duration) || 24);
  }

  result.lights.sunrise = 15;
  result.lights.sunset = 15;
  result.lights.limit = preset.lightLimit;

  result.co2.target = options.hasCo2 ? preset.co2Enriched : preset.co2Ambient;

  return result;
}

/**
 * Derives which preset the configuration currently matches. Compares only
 * values a preset writes and the firmware reliably echoes; CO2 and
 * sunrise/sunset are excluded to keep detection robust across setups.
 */
export function detectActiveStagePreset(settings: any): GrowStagePresetId | 'custom' | null {
  if (!settings?.workmode) {
    return null;
  }

  for (const preset of GROW_STAGE_PRESETS) {
    if (settings.workmode !== preset.workmode) {
      continue;
    }

    if (preset.workmode === 'dry') {
      if (
        near(settings.night?.temperature, preset.nightTemperature, TEMPERATURE_TOLERANCE) &&
        near(settings.night?.humidity, preset.nightHumidity, HUMIDITY_TOLERANCE)
      ) {
        return preset.id;
      }
      continue;
    }

    if (!near(settings.day?.temperature, preset.dayTemperature, TEMPERATURE_TOLERANCE)) continue;
    if (!near(settings.night?.temperature, preset.nightTemperature, TEMPERATURE_TOLERANCE)) continue;
    if (!near(settings.day?.humidity, preset.dayHumidity, HUMIDITY_TOLERANCE)) continue;
    if (!near(settings.night?.humidity, preset.nightHumidity, HUMIDITY_TOLERANCE)) continue;
    if (!near(settings.lights?.limit, preset.lightLimit, LIGHT_LIMIT_TOLERANCE)) continue;

    if (settings.daynight?.floating) {
      if (!near(settings.daynight?.light_duration, preset.lightHours, 0.3)) continue;
    } else {
      const photoperiod = (Number(settings.daynight?.night) - Number(settings.daynight?.day) + 86400) % 86400;
      if (!near(photoperiod, preset.lightHours * 3600, PHOTOPERIOD_TOLERANCE_SECONDS)) continue;
    }

    return preset.id;
  }

  return 'custom';
}

export interface GrowPlanTemplateStep {
  presetId: GrowStagePresetId;
  durationDays: number;
  /** Autoflowers keep long light days through flowering. */
  lightHoursOverride?: number;
  waitForConfirmation?: boolean;
  nameKey: string;
  confirmationKey?: string;
}

export interface GrowPlanTemplate {
  id: 'photoperiod' | 'autoflower';
  nameKey: string;
  descriptionKey: string;
  steps: GrowPlanTemplateStep[];
}

export const GROW_PLAN_TEMPLATES: GrowPlanTemplate[] = [
  {
    id: 'photoperiod',
    nameKey: 'growPresets.plans.photoperiod.name',
    descriptionKey: 'growPresets.plans.photoperiod.description',
    steps: [
      { presetId: 'seedling', durationDays: 14, nameKey: 'growPresets.stages.seedling' },
      {
        presetId: 'vegetative',
        durationDays: 28,
        waitForConfirmation: true,
        nameKey: 'growPresets.stages.vegetative',
        confirmationKey: 'growPresets.confirmations.startFlowering',
      },
      { presetId: 'flowering', durationDays: 42, nameKey: 'growPresets.stages.flowering' },
      {
        presetId: 'late_flowering',
        durationDays: 21,
        waitForConfirmation: true,
        nameKey: 'growPresets.stages.lateFlowering',
        confirmationKey: 'growPresets.confirmations.harvest',
      },
      {
        presetId: 'drying',
        durationDays: 10,
        waitForConfirmation: true,
        nameKey: 'growPresets.stages.drying',
        confirmationKey: 'growPresets.confirmations.dryingDone',
      },
    ],
  },
  {
    id: 'autoflower',
    nameKey: 'growPresets.plans.autoflower.name',
    descriptionKey: 'growPresets.plans.autoflower.description',
    steps: [
      { presetId: 'seedling', durationDays: 10, nameKey: 'growPresets.stages.seedling' },
      { presetId: 'vegetative', durationDays: 18, nameKey: 'growPresets.stages.vegetative' },
      { presetId: 'flowering', durationDays: 28, lightHoursOverride: 18, nameKey: 'growPresets.stages.flowering' },
      {
        presetId: 'late_flowering',
        durationDays: 14,
        lightHoursOverride: 18,
        waitForConfirmation: true,
        nameKey: 'growPresets.stages.lateFlowering',
        confirmationKey: 'growPresets.confirmations.harvest',
      },
      {
        presetId: 'drying',
        durationDays: 10,
        waitForConfirmation: true,
        nameKey: 'growPresets.stages.drying',
        confirmationKey: 'growPresets.confirmations.dryingDone',
      },
    ],
  },
];

/**
 * Builds a ready-to-save Recipe from a plan template: one step per stage,
 * each carrying the current configuration with the stage preset applied.
 * Step settings stay parsed objects here — callers stringify them for the
 * API, matching the existing recipe save convention.
 */
export function buildRecipeFromTemplate(
  template: GrowPlanTemplate,
  baseSettings: any,
  options: { hasCo2: boolean; durations?: number[]; email?: string; translate: (key: string) => string },
): Recipe {
  const steps: RecipeStep[] = template.steps.map((templateStep, index) => {
    const preset = getStagePreset(templateStep.presetId);
    const settings = applyStagePreset(baseSettings, templateStep.presetId, {
      hasCo2: options.hasCo2,
      lightHours: templateStep.lightHoursOverride,
    });

    return {
      name: options.translate(templateStep.nameKey),
      stage: preset.stage,
      settings,
      duration: options.durations?.[index] ?? templateStep.durationDays,
      durationUnit: 'days' as const,
      waitForConfirmation: !!templateStep.waitForConfirmation,
      confirmationMessage: templateStep.confirmationKey ? options.translate(templateStep.confirmationKey) : undefined,
      notified: false,
    };
  });

  return {
    steps,
    activeStepIndex: 0,
    activeSince: 0,
    loop: false,
    notifications: 'onStep',
    additionalInfo: true,
    email: options.email,
  };
}
