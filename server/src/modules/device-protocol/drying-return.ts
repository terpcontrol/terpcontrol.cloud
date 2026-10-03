import type { DeviceConfiguration, DryingReturn, PhaseTargets } from '@fg2/shared-types/v1';

/**
 * What a drying spell puts aside and what ending it brings back.
 *
 * Drying is a climate of its own - 18 °C, 58 %, no light, no CO2 - written over
 * the targets the device held. A spell ended by a preset, a phase or a plan step
 * brings the next climate with it; one ended by itself, with its own button or
 * by switching control off, brings none, and the device went back to its day
 * and night at the drying room's figures, in the dark. So the figures the spell
 * writes over are kept when it begins and written back when it ends by itself.
 */

/** The figures a drying climate sets, by their paths in the document. */
export const DRYING_FIGURES = ['day.temperature', 'day.humidity', 'night.temperature', 'night.humidity', 'co2.target', 'lights.limit'] as const;

/** What the firmware lights at out of the box: what a spell nobody kept anything from comes back to, rather than staying dark. */
const FACTORY_LIGHT_LIMIT = 100;

const numberAt = (configuration: DeviceConfiguration | null, path: string): number | null => {
  const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], configuration);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** The figures of a document a spell is about to write over, as they are kept: by path, the ones it states. */
export const keptForDrying = (configuration: DeviceConfiguration | null): Record<string, number> =>
  Object.fromEntries(DRYING_FIGURES.flatMap(path => (numberAt(configuration, path) === null ? [] : [[path, numberAt(configuration, path)!]])));

/**
 * What germination may write over: the night's temperature, which it holds
 * round the clock, and the night's humidity, which a humidifier that holds goes
 * by and which may be set for the seeds. The ones the document states.
 */
export const GERMINATION_FIGURES = ['night.temperature', 'night.humidity'] as const;

export const keptForGermination = (configuration: DeviceConfiguration | null): Record<string, number> =>
  Object.fromEntries(GERMINATION_FIGURES.flatMap(path => (numberAt(configuration, path) === null ? [] : [[path, numberAt(configuration, path)!]])));

/**
 * What to bring back where nothing was kept - a spell begun before anything
 * was: the targets the record holds from before it, and a lamp the spell left
 * dark lit again at the firmware's own limit.
 */
export const recordedReturn = (recorded: PhaseTargets | null, current: DeviceConfiguration | null): Record<string, number> => ({
  ...Object.fromEntries(
    (
      [
        ['day.temperature', recorded?.day.temperature],
        ['day.humidity', recorded?.day.humidity],
        ['night.temperature', recorded?.night.temperature],
        ['night.humidity', recorded?.night.humidity],
        ['co2.target', recorded?.co2],
      ] as const
    ).flatMap(([path, value]) => (typeof value === 'number' ? [[path, value]] : [])),
  ),
  ...(numberAt(current, 'lights.limit') === 0 ? { 'lights.limit': FACTORY_LIGHT_LIMIT } : {}),
});

/** The kept figures as the screens read them. */
export const dryingReturnOf = (kept: Record<string, number>): DryingReturn => ({
  dayTemperature: kept['day.temperature'] ?? null,
  dayHumidity: kept['day.humidity'] ?? null,
  nightTemperature: kept['night.temperature'] ?? null,
  nightHumidity: kept['night.humidity'] ?? null,
  co2: kept['co2.target'] ?? null,
  lightLimit: kept['lights.limit'] ?? null,
});
