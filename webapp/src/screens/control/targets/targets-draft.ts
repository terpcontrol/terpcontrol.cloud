import type { DateTime } from 'luxon';
import type { Device, DeviceConfiguration, DeviceSettings, GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset, PRESETS_OF_STAGE, STAGES_WITH_CLIMATE, type ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { serverNow } from '@/api/clock';
import { figureOf, sectionOf } from '@/ui/climate-hardware';
import { CLOCK } from '@/ui/zone';

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
  /** When the light comes on, in seconds past midnight UTC. Kept where it is: what is set here is how long it stays on. */
  lightsOn: number;
  /** How long the light is on, in hours. Fractional where the document was written by hand to a half hour. */
  lightHours: number;
  co2: number;
}

const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;

/** The firmware's own defaults, for a document that has never stated a figure. */
const DEFAULTS: TargetsDraft = {
  dayTemperature: 25,
  dayHumidity: 60,
  nightTemperature: 25,
  nightHumidity: 60,
  lightLimit: 100,
  lightsOn: 6 * HOUR_SECONDS,
  lightHours: 16,
  co2: 400,
};

/** How long the light is on from when it comes on and goes off. Off at the same second it comes on is a day-long light. */
const hoursBetween = (on: number, off: number): number => {
  const seconds = (((off - on) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  return (seconds === 0 ? DAY_SECONDS : seconds) / HOUR_SECONDS;
};

export const draftOf = (configuration: DeviceConfiguration): TargetsDraft => {
  const lightsOn = figureOf(configuration, 'daynight', 'day') ?? DEFAULTS.lightsOn;
  const lightsOff = figureOf(configuration, 'daynight', 'night');

  return {
    dayTemperature: figureOf(configuration, 'day', 'temperature') ?? DEFAULTS.dayTemperature,
    dayHumidity: figureOf(configuration, 'day', 'humidity') ?? DEFAULTS.dayHumidity,
    nightTemperature: figureOf(configuration, 'night', 'temperature') ?? DEFAULTS.nightTemperature,
    nightHumidity: figureOf(configuration, 'night', 'humidity') ?? DEFAULTS.nightHumidity,
    lightLimit: figureOf(configuration, 'lights', 'limit') ?? DEFAULTS.lightLimit,
    lightsOn,
    lightHours: lightsOff === null ? DEFAULTS.lightHours : hoursBetween(lightsOn, lightsOff),
    co2: figureOf(configuration, 'co2', 'target') ?? DEFAULTS.co2,
  };
};

/**
 * The document to send for a draft: the old one, with the figures put into
 * their sections and the flat spelling of each removed where it was used, so
 * one document never states the same figure twice.
 */
export const withDraft = (configuration: DeviceConfiguration, draft: TargetsDraft): DeviceConfiguration => {
  const next: DeviceConfiguration = { ...configuration };
  for (const flat of [
    'day.temperature',
    'day.humidity',
    'night.temperature',
    'night.humidity',
    'co2.target',
    'lights.limit',
    'daynight.day',
    'daynight.night',
  ]) {
    delete next[flat];
  }

  next.day = { ...sectionOf(configuration, 'day'), temperature: draft.dayTemperature, humidity: draft.dayHumidity };
  next.night = { ...sectionOf(configuration, 'night'), temperature: draft.nightTemperature, humidity: draft.nightHumidity };
  next.co2 = { ...sectionOf(configuration, 'co2'), target: draft.co2 };
  next.lights = { ...sectionOf(configuration, 'lights'), limit: draft.lightLimit };
  next.daynight = {
    ...sectionOf(configuration, 'daynight'),
    day: draft.lightsOn,
    night: (draft.lightsOn + Math.round(draft.lightHours * HOUR_SECONDS)) % DAY_SECONDS,
  };

  return next;
};

/* ------------------------------------------------------------- the presets */

/** A chip: a stage on its own, or a preset refining one. */
export interface PresetChip {
  stage: GrowthStage;
  preset: string | null;
}

/**
 * The chips in the order the board draws them: each stage with its own presets
 * beside it, and the autoflower rows at the end - they are the same stages kept
 * under a long day, and read as one group. Germination writes what a seedling
 * does and is left out.
 */
export const PRESET_CHIPS: PresetChip[] = (() => {
  const stages = STAGES_WITH_CLIMATE.filter(stage => stage !== 'germination');
  const chips: PresetChip[] = [];
  for (const stage of stages) {
    chips.push({ stage, preset: null });
    for (const preset of PRESETS_OF_STAGE[stage] ?? []) if (preset !== 'autoflower') chips.push({ stage, preset });
  }
  for (const stage of stages) if (PRESETS_OF_STAGE[stage]?.includes('autoflower')) chips.push({ stage, preset: 'autoflower' });
  return chips;
})();

export const presetOf = (chip: PresetChip): ClimatePreset | null => climatePreset(chip.stage, chip.preset);

/**
 * The draft with a preset's figures in it. Only the sliders move: nothing is
 * written until it is saved. A preset that says nothing about the light hours
 * - drying - leaves the photoperiod where it is, as it does on the server.
 */
export const prefilled = (draft: TargetsDraft, preset: ClimatePreset): TargetsDraft => ({
  ...draft,
  dayTemperature: preset.dayTemperature,
  dayHumidity: preset.dayHumidity,
  nightTemperature: preset.nightTemperature,
  nightHumidity: preset.nightHumidity,
  lightLimit: preset.lightLimit,
  lightHours: preset.lightHours ?? draft.lightHours,
  co2: preset.co2,
});

/**
 * Whether the draft is what a preset would prefill, which is what draws its
 * chip chosen. A tent without a CO2 sensor has no CO2 slider, so its figure is
 * not held against the draft there: the firmware forces it to nothing anyway.
 */
export const equalsPreset = (draft: TargetsDraft, preset: ClimatePreset, hasCo2: boolean): boolean =>
  draft.dayTemperature === preset.dayTemperature &&
  draft.dayHumidity === preset.dayHumidity &&
  draft.nightTemperature === preset.nightTemperature &&
  draft.nightHumidity === preset.nightHumidity &&
  draft.lightLimit === preset.lightLimit &&
  (preset.lightHours === null || draft.lightHours === preset.lightHours) &&
  (!hasCo2 || draft.co2 === preset.co2);

export const sameDraft = (a: TargetsDraft, b: TargetsDraft): boolean => (Object.keys(a) as (keyof TargetsDraft)[]).every(key => a[key] === b[key]);

/* ------------------------------------------------------------- the figures */

/** Whether the device reported a CO2 sensor; without one the firmware forces the target to zero. */
export const hasCo2Sensor = (device: Device): boolean => device.state.hardware.co2 === 'on';

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

/**
 * "06-18 h": when the light comes on and goes off, on the clock beside the
 * tent. The document holds seconds past midnight UTC, so a tent in Berlin that
 * lights at six is stored as four; the label says what the clock on the wall
 * will say - that wall being where the account is kept, which is the zone the
 * server reads the same account's quiet hours in, and not where the phone
 * reading this happens to be. Minutes are shown only where a window does not
 * fall on the hour.
 */
export const lightWindowLabel = (draft: TargetsDraft, now: DateTime = serverNow(), zone: string | null = null): string => {
  const midnight = now.toUTC().startOf('day');
  const there = (at: DateTime) => (zone ? at.setZone(zone) : at.toLocal());
  const on = there(midnight.plus({ seconds: draft.lightsOn }));
  const off = there(midnight.plus({ seconds: draft.lightsOn + Math.round(draft.lightHours * HOUR_SECONDS) }));
  const format = on.minute === 0 && off.minute === 0 ? 'HH' : CLOCK;

  return `${on.toFormat(format)}–${off.toFormat(format)} h`;
};
