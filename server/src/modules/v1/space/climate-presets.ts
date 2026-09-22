import type { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';

/**
 * A climate preset as the device's own configuration document.
 *
 * The figures themselves are the contract's one table, shared with the manual
 * targets page that prefills from it; what is decided here is only how a row of
 * that table lands in the document a controller is running.
 */

/** When the light comes on where the device has never said, in seconds past midnight UTC: the firmware's own default. */
const DEFAULT_LIGHTS_ON = 6 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * The preset merged into the document the device is running.
 *
 * Section by section rather than key by key, because a configuration is stored
 * and sent whole and a section written as `{ target }` would take the rest of
 * that section with it - the dimming ramps, the dehumidifier timing, everything
 * the tent was tuned with.
 *
 * The hour the light comes on is the grower's and is kept; what a preset says
 * about light is how long it stays on. `curing` has no row, and a stage with no
 * row writes nothing at all rather than a climate somebody invented.
 */
export const presetConfiguration = (stage: GrowthStage, preset: string | null, current: DeviceConfiguration | null): DeviceConfiguration | null => {
  const wanted = climatePreset(stage, preset);
  if (!wanted) return null;

  const section = (key: string): Record<string, unknown> => {
    const value = current?.[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  };

  const daynight = section('daynight');
  const lightsOn = typeof daynight.day === 'number' ? daynight.day : DEFAULT_LIGHTS_ON;

  return {
    day: { ...section('day'), temperature: wanted.dayTemperature, humidity: wanted.dayHumidity },
    night: { ...section('night'), temperature: wanted.nightTemperature, humidity: wanted.nightHumidity },
    co2: { ...section('co2'), target: wanted.co2 },
    lights: { ...section('lights'), limit: wanted.lightLimit },
    daynight: wanted.lightHours === null ? daynight : { ...daynight, day: lightsOn, night: (lightsOn + wanted.lightHours * 60 * 60) % DAY_SECONDS },
  };
};
