import type { PhaseTargets } from '@fg2/shared-types/v1';

/**
 * The targets a controller is running, as the phase records them.
 *
 * Influx stores what was measured and what was switched, never a setpoint, so a
 * phase that is over has no other way to draw its target band than the snapshot
 * taken when it began.
 *
 * The keys are the device's own configuration document, which every type states
 * as a path (`day.temperature`). A device that reports it nested and a client
 * that wrote it flat mean the same thing, so both are read.
 */

const PATHS = {
  dayTemperature: 'day.temperature',
  dayHumidity: 'day.humidity',
  nightTemperature: 'night.temperature',
  nightHumidity: 'night.humidity',
  co2: 'co2.target',
} as const;

export const targetsOf = (configuration: Record<string, unknown> | null | undefined): PhaseTargets | null => {
  if (!configuration) return null;

  const targets: PhaseTargets = {
    day: { temperature: numberAt(configuration, PATHS.dayTemperature), humidity: numberAt(configuration, PATHS.dayHumidity) },
    night: { temperature: numberAt(configuration, PATHS.nightTemperature), humidity: numberAt(configuration, PATHS.nightHumidity) },
    co2: numberAt(configuration, PATHS.co2),
  };

  // A device that states none of them - a plug, a light - has no targets rather
  // than four nulls to draw a band from.
  const values = [targets.day.temperature, targets.day.humidity, targets.night.temperature, targets.night.humidity, targets.co2];
  return values.some(value => value !== null) ? targets : null;
};

const numberAt = (configuration: Record<string, unknown>, path: string): number | null => {
  const nested = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], configuration);
  const value = nested ?? configuration[path];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
