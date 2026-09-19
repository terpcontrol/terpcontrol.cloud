import type { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';

/**
 * What each growth stage asks of a tent.
 *
 * The figures are the ones the phase tiles have always written, and they are
 * deliberately conservative: they are what a beginner's tent is safe at rather
 * than what a competition is won with. `docs/einfach-modus.md` carries the same
 * table with the reasoning per row.
 *
 * `stage` is the botanical fact and is the key; `preset` refines one stage into
 * the step the screens draw - "Late flower" is `flowering` with the preset
 * `late_flowering` - and a preset this table has never heard of falls back to
 * its stage, because the preset list ships with the client and may grow without
 * the server being told.
 *
 * What is *not* here is as deliberate: the work mode, the heating and
 * dehumidifying behaviour, the fans and the dimming ramps are what the hardware
 * is tuned to and survive a phase change. A preset is a target climate, not a
 * decision about the machine.
 */

interface ClimatePreset {
  dayTemperature: number;
  nightTemperature: number;
  dayHumidity: number;
  nightHumidity: number;
  /** How long the light is on, in hours. Null leaves the photoperiod where it is, which is what a stage kept dark does. */
  lightHours: number | null;
  /** Per cent of the light's own maximum. Zero is a stage that is kept dark. */
  lightLimit: number;
  /** Parts per million. The firmware forces it to zero where no CO2 sensor is fitted, so a tent without one opens no valve. */
  co2: number;
}

const AMBIENT_CO2 = 400;

const PRESETS: Readonly<Record<string, ClimatePreset>> = {
  germination: { dayTemperature: 24, nightTemperature: 21, dayHumidity: 70, nightHumidity: 65, lightHours: 18, lightLimit: 40, co2: AMBIENT_CO2 },
  seedling: { dayTemperature: 24, nightTemperature: 21, dayHumidity: 70, nightHumidity: 65, lightHours: 18, lightLimit: 40, co2: AMBIENT_CO2 },
  vegetative: { dayTemperature: 26, nightTemperature: 22, dayHumidity: 62, nightHumidity: 58, lightHours: 18, lightLimit: 80, co2: 900 },
  flowering: { dayTemperature: 25, nightTemperature: 20, dayHumidity: 50, nightHumidity: 50, lightHours: 12, lightLimit: 100, co2: 1000 },
  'flowering:late_flowering': {
    dayTemperature: 24,
    nightTemperature: 18,
    dayHumidity: 45,
    nightHumidity: 45,
    lightHours: 12,
    lightLimit: 100,
    co2: AMBIENT_CO2,
  },
  drying: { dayTemperature: 18, nightTemperature: 18, dayHumidity: 58, nightHumidity: 58, lightHours: null, lightLimit: 0, co2: AMBIENT_CO2 },
};

/** When the light comes on where the device has never said, in seconds past midnight UTC: the firmware's own default. */
const DEFAULT_LIGHTS_ON = 6 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

export const climatePreset = (stage: GrowthStage, preset: string | null): ClimatePreset | null =>
  (preset === null ? null : PRESETS[`${stage}:${preset}`]) ?? PRESETS[stage] ?? null;

/**
 * The preset as the device's own configuration document, merged into the one it
 * is running.
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
