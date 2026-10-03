import type { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { lightWindowOf, lightWindowTimes } from '@fg2/shared-types/v1-schemas/day-night.js';

/**
 * A climate preset as the device's own configuration document.
 *
 * The figures themselves are the contract's one table, shared with the manual
 * targets page that prefills from it; what is decided here is only how a row of
 * that table lands in the document a controller is running.
 */

/**
 * The preset merged into the document the device is running.
 *
 * Section by section rather than key by key, because a configuration is stored
 * and sent whole and a section written as `{ target }` would take the rest of
 * that section with it - the dimming ramps, the dehumidifier timing, everything
 * the tent was tuned with.
 *
 * The hour the light comes on is the grower's and is kept - the firmware's own
 * 06:00 UTC where the device has never said - and what a preset says about
 * light is how long it stays on, written the one way every window is written
 * (`lightWindowTimes`). `curing` has no row, and a stage with no row writes
 * nothing at all rather than a climate somebody invented. A figure the row
 * leaves out is not written: germination names its one temperature, and the
 * day, the humidity, the lamp and the CO2 stay for the climate after it.
 *
 * The CO2 target is written only where the device says it can measure one. A
 * controller that reports no sensor forces the target to zero as it reads the
 * document, so writing the preset's figure into one left the cloud holding and
 * showing a target of 1000 for hardware running nothing - and the app's own
 * manual targets page draws that row dead and says it needs a sensor. What is
 * already in the section is kept either way; nothing is written over, the
 * figure is simply not put there.
 */
export const presetConfiguration = (
  stage: GrowthStage,
  preset: string | null,
  current: DeviceConfiguration | null,
  hasCo2Sensor: boolean,
): DeviceConfiguration | null => {
  const wanted = climatePreset(stage, preset);
  if (!wanted) return null;

  const section = (key: string): Record<string, unknown> => {
    const value = current?.[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  };

  const daynight = section('daynight');
  const { lightsOn } = lightWindowOf(numberOrNull(daynight.day), numberOrNull(daynight.night));
  const figures = (key: string, named: Record<string, number | null>): DeviceConfiguration => {
    const set = Object.entries(named).filter(([, value]) => value !== null);
    return set.length === 0 ? {} : { [key]: { ...section(key), ...Object.fromEntries(set) } };
  };

  return {
    ...figures('day', { temperature: wanted.dayTemperature, humidity: wanted.dayHumidity }),
    ...figures('night', { temperature: wanted.nightTemperature, humidity: wanted.nightHumidity }),
    ...(hasCo2Sensor ? figures('co2', { target: wanted.co2 }) : {}),
    ...figures('lights', { limit: wanted.lightLimit }),
    ...(wanted.lightHours === null ? {} : { daynight: { ...daynight, ...lightWindowTimes({ lightsOn, lightHours: wanted.lightHours }) } }),
  };
};

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
