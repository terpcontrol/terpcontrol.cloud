import type { DeviceConfiguration, DeviceSettings } from '@fg2/shared-types/v1';
import { climatePreset, type ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { sectionOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { lightWindowOf, lightWindowTimes } from '@fg2/shared-types/v1-schemas/day-night.js';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { figureOf } from '@/ui/climate-hardware';
import type { ClimateChoice } from '@/ui/presets';

/**
 * The targets a controller holds by hand, read out of its configuration
 * document and written back into it.
 *
 * The document is the firmware's: nested sections, a flat spelling where an old
 * client once wrote one, and beside the six figures a person sets here all the
 * tuning the tent was set up with - the ramps, the dehumidifier's timing, the
 * work mode. A draft is therefore only the figures, and the document a save
 * sends is the old one with those figures put into their sections, exactly as
 * the server lands a preset in it: section by section, keeping every other key,
 * because the route replaces the document whole and a section written as
 * `{ target }` would take the rest of that section with it.
 */

export interface TargetsDraft {
  dayTemperature: number;
  dayHumidity: number;
  nightTemperature: number;
  nightHumidity: number;
  /** Per cent of the lamp's own maximum. */
  lightLimit: number;
  /** When the light comes on, in seconds past midnight UTC: the firmware's own clock, which knows no zone. */
  lightsOn: number;
  /** How long the light is on, in hours. Fractional where the document was written by hand to a half hour. */
  lightHours: number;
  co2: number;
}

/** The two figures of a light schedule, which is all the light window is worked out from. */
export type LightSchedule = Pick<TargetsDraft, 'lightsOn' | 'lightHours'>;

/** The firmware's own defaults, for a document that has never stated a figure. Its light window's are the shared module's. */
const DEFAULTS: Omit<TargetsDraft, 'lightsOn' | 'lightHours'> = {
  dayTemperature: 25,
  dayHumidity: 60,
  nightTemperature: 25,
  nightHumidity: 60,
  lightLimit: 100,
  co2: 400,
};

export const draftOf = (configuration: DeviceConfiguration): TargetsDraft => {
  // Read the way the firmware reads the two times: a day that never ends is 24
  // hours, the light going off the second it comes on none at all, and the
  // times a document leaves out are the firmware's own.
  const { lightsOn, lightHours } = lightWindowOf(figureOf(configuration, 'daynight', 'day'), figureOf(configuration, 'daynight', 'night'));

  return {
    dayTemperature: figureOf(configuration, 'day', 'temperature') ?? DEFAULTS.dayTemperature,
    dayHumidity: figureOf(configuration, 'day', 'humidity') ?? DEFAULTS.dayHumidity,
    nightTemperature: figureOf(configuration, 'night', 'temperature') ?? DEFAULTS.nightTemperature,
    nightHumidity: figureOf(configuration, 'night', 'humidity') ?? DEFAULTS.nightHumidity,
    lightLimit: figureOf(configuration, 'lights', 'limit') ?? DEFAULTS.lightLimit,
    lightsOn,
    lightHours,
    co2: figureOf(configuration, 'co2', 'target') ?? DEFAULTS.co2,
  };
};

/**
 * Where the figures a save writes come from.
 *
 * - `both`: the day's and the night's, each as the draft has them. A half the
 *   page does not show - the night at 24 hours of light, the day at none or in
 *   germination - is written as it was stored, so it is still there when a
 *   night or a day comes back; the server keeps it through the save as well.
 * - `drying`: the night's figures, which a drying fridge holds round the
 *   clock, written into the day as well, so a spell started from the page
 *   stores what it holds. Once a fridge is drying the server keeps its stored
 *   day through any save of the targets, and the day the spell put aside is
 *   the server's to bring back when the spell ends (`afterDrying`).
 */
export type HeldHalves = 'both' | 'drying';

/**
 * The document to send for a draft: the old one, with the figures put into
 * their sections and the flat spelling of each removed where it was used, so
 * one document never states the same figure twice.
 *
 * `climateOnly` is an AIR fan's document, which holds a temperature and a
 * humidity and nothing of a light or of CO2: its day is what its light sensor
 * sees, so those sections would be keys it never reads.
 *
 * `held` says where the figures come from (`HeldHalves`). The light schedule
 * and the lamp are written as the draft has them either way: a drying spell
 * keeps them for when it ends.
 */
export const withDraft = (
  configuration: DeviceConfiguration,
  draft: TargetsDraft,
  climateOnly = false,
  held: HeldHalves = 'both',
): DeviceConfiguration => {
  const next: DeviceConfiguration = { ...configuration };
  for (const flat of [
    'day.temperature',
    'day.humidity',
    'night.temperature',
    'night.humidity',
    ...(climateOnly ? [] : ['co2.target', 'lights.limit', 'daynight.day', 'daynight.night']),
  ]) {
    delete next[flat];
  }

  const day = { temperature: draft.dayTemperature, humidity: draft.dayHumidity };
  const night = { temperature: draft.nightTemperature, humidity: draft.nightHumidity };
  next.day = { ...sectionOf(configuration, 'day'), ...(held === 'drying' ? night : day) };
  next.night = { ...sectionOf(configuration, 'night'), ...night };
  if (climateOnly) return next;

  next.co2 = { ...sectionOf(configuration, 'co2'), target: draft.co2 };
  next.lights = { ...sectionOf(configuration, 'lights'), limit: draft.lightLimit };
  next.daynight = { ...sectionOf(configuration, 'daynight'), ...lightWindowTimes(draft) };

  return next;
};

/* ------------------------------------------------------------- the presets */

/** The figures a chip prefills: the shared table's row for its stage and preset. */
export const presetOf = (chip: ClimateChoice): ClimatePreset | null => climatePreset(chip.stage, chip.preset);

/**
 * The draft with a preset's figures in it. Only the figures move: nothing is
 * written until it is saved. A figure the preset leaves out stays where it is,
 * as it does on the server: drying says nothing about the light hours, and
 * germination names its temperature and its humidity and nothing else.
 */
export const prefilled = (draft: TargetsDraft, preset: ClimatePreset): TargetsDraft => ({
  ...draft,
  dayTemperature: preset.dayTemperature ?? draft.dayTemperature,
  dayHumidity: preset.dayHumidity ?? draft.dayHumidity,
  nightTemperature: preset.nightTemperature,
  nightHumidity: preset.nightHumidity ?? draft.nightHumidity,
  lightLimit: preset.lightLimit ?? draft.lightLimit,
  lightHours: preset.lightHours ?? draft.lightHours,
  co2: preset.co2 ?? draft.co2,
});

/** Whether a figure of the draft is what the preset says, where the preset says anything about it. */
const fits = (value: number, wanted: number | null): boolean => wanted === null || value === wanted;

/**
 * Whether the draft is what a preset would prefill, which is what draws its
 * chip chosen. A tent without a CO2 sensor has no CO2 field, so its figure is
 * not held against the draft there: the firmware forces it to nothing anyway.
 */
export const equalsPreset = (draft: TargetsDraft, preset: ClimatePreset, hasCo2: boolean, climateOnly = false): boolean =>
  fits(draft.dayTemperature, preset.dayTemperature) &&
  fits(draft.dayHumidity, preset.dayHumidity) &&
  draft.nightTemperature === preset.nightTemperature &&
  fits(draft.nightHumidity, preset.nightHumidity) &&
  (climateOnly ||
    (fits(draft.lightLimit, preset.lightLimit) && fits(draft.lightHours, preset.lightHours) && (!hasCo2 || fits(draft.co2, preset.co2))));

export const sameDraft = (a: TargetsDraft, b: TargetsDraft): boolean => (Object.keys(a) as (keyof TargetsDraft)[]).every(key => a[key] === b[key]);

/* ------------------------------------------------------------- the figures */

/**
 * The VPD a pair of targets amounts to, worked out along the contract's own
 * curve, which is the one the server works a reading's VPD out along: the
 * deficit between the leaf, offset from the air by the device's own setting,
 * and the air at the target humidity. A grower sets temperature and humidity
 * but grows by this figure, so it stands beside them.
 */
export const vpdOf = (temperature: number, humidity: number, leafOffset: number): number =>
  vapourPressureDeficit(temperature, temperature + leafOffset, humidity);

export const leafOffset = (settings: DeviceSettings, when: 'day' | 'night'): number =>
  when === 'day' ? settings.vpdLeafOffsetDay : settings.vpdLeafOffsetNight;
