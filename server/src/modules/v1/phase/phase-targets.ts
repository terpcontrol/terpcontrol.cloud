import type { PhaseTargets } from '@fg2/shared-types/v1';
import { figureAt } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

/**
 * The targets a controller is running, as the phase records them.
 *
 * Influx stores what was measured and what was switched, never a setpoint, so a
 * phase keeps a snapshot of what ran when it began. It is what the phase's band
 * is drawn from wherever the device's target record (`target-record.ts`) does
 * not reach back that far, and the same reading of a configuration is what
 * that record stores.
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
    day: { temperature: figureAt(configuration, PATHS.dayTemperature), humidity: figureAt(configuration, PATHS.dayHumidity) },
    night: { temperature: figureAt(configuration, PATHS.nightTemperature), humidity: figureAt(configuration, PATHS.nightHumidity) },
    co2: figureAt(configuration, PATHS.co2),
  };

  // A device that states none of them - a plug, a light - has no targets rather
  // than four nulls to draw a band from.
  const values = [targets.day.temperature, targets.day.humidity, targets.night.temperature, targets.night.humidity, targets.co2];
  return values.some(value => value !== null) ? targets : null;
};
