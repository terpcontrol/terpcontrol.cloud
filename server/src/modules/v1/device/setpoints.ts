import type { Metric, Setpoints } from '@fg2/shared-types/v1';

/**
 * The targets a controller is holding, read out of its own configuration
 * document. Influx stores what was measured and what was switched and never a
 * setpoint, so the configuration is the only place one comes from.
 *
 * The keys are the device's, which every type states as a path
 * (`day.temperature`). A device that reports it nested and a client that wrote
 * it flat mean the same thing, so both are read.
 */

/** The configuration path each metric's target is stated at, per half of the cycle. */
const TARGETS: Readonly<Record<'day' | 'night', Partial<Record<Metric, string>>>> = {
  // The CO2 target is one number for the whole cycle: the controller holds it
  // whichever half it is in, so both halves answer the same value.
  day: { temperature: 'day.temperature', humidity: 'day.humidity', co2: 'co2.target' },
  night: { temperature: 'night.temperature', humidity: 'night.humidity', co2: 'co2.target' },
};

/**
 * `isDay` is what the device says about itself, and it is not optional: a target
 * band nobody can say which half of belongs to is worse than none, so a device
 * that has not reported the flag answers no setpoints at all. Nor does one that
 * states no target - a plug, a light.
 */
export const setpointsOf = (configuration: Record<string, unknown> | null, isDay: boolean | null): Setpoints | null => {
  if (!configuration || isDay === null) return null;

  const setpoints: Setpoints = { day: halfOf(configuration, 'day'), night: halfOf(configuration, 'night'), active: isDay ? 'day' : 'night' };

  return Object.keys(setpoints.day).length + Object.keys(setpoints.night).length > 0 ? setpoints : null;
};

const halfOf = (configuration: Record<string, unknown>, half: 'day' | 'night'): Partial<Record<Metric, number>> => {
  const targets: Partial<Record<Metric, number>> = {};

  for (const [metric, path] of Object.entries(TARGETS[half]) as [Metric, string][]) {
    const value = numberAt(configuration, path);
    if (value !== null) targets[metric] = value;
  }

  return targets;
};

const numberAt = (configuration: Record<string, unknown>, path: string): number | null => {
  const nested = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], configuration);
  const value = nested ?? configuration[path];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
