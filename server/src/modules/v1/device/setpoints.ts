import type { Metric, Setpoints } from '@fg2/shared-types/v1';
import { reportsNoSensor } from '@common/v1/sentinels';

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
 *
 * `hardware` is the device's own report of what is fitted, and it is read for
 * the same reason the readings read it: a controller keeps a CO2 target in its
 * document whether or not an SCD was ever screwed into it, and a target with
 * nothing to measure against is a figure the tent cannot be held to. The tent's
 * own targets line said "CO2 1200" over a fridge whose Manual targets tab, two
 * taps away, said the row needed a sensor. Answering the target here and not
 * there was what let those two sentences stand on one account.
 */
export const setpointsOf = (
  configuration: Record<string, unknown> | null,
  isDay: boolean | null,
  hardware: Record<string, string> = {},
): Setpoints | null => {
  if (!configuration || isDay === null) return null;

  const setpoints: Setpoints = {
    day: halfOf(configuration, 'day', hardware),
    night: halfOf(configuration, 'night', hardware),
    active: isDay ? 'day' : 'night',
  };

  return Object.keys(setpoints.day).length + Object.keys(setpoints.night).length > 0 ? setpoints : null;
};

const halfOf = (configuration: Record<string, unknown>, half: 'day' | 'night', hardware: Record<string, string>): Partial<Record<Metric, number>> => {
  const targets: Partial<Record<Metric, number>> = {};

  for (const [metric, path] of Object.entries(TARGETS[half]) as [Metric, string][]) {
    if (reportsNoSensor(hardware, metric)) continue;
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
