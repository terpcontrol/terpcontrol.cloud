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

  const held = HELD[String(configuration.workmode)] ?? null;
  const setpoints: Setpoints = {
    day: held?.nightOnly ? {} : halfOf(configuration, 'day', hardware, held),
    night: halfOf(configuration, 'night', hardware, held),
    active: isDay && !held?.nightOnly ? 'day' : 'night',
  };

  return Object.keys(setpoints.day).length + Object.keys(setpoints.night).length > 0 ? setpoints : null;
};

/**
 * What a work mode holds of the targets, where it does not hold all of them.
 * Switched off the firmware holds none. Drying and germination know no day -
 * the firmware calls neither one - and hold the night's figures: drying its
 * temperature and humidity without CO2, germination the temperature alone. The
 * greenhouse mode holds no humidity. A figure a mode does not hold is not one
 * the tent can be judged by, however it reads.
 */
const HELD: Readonly<Record<string, { metrics: readonly Metric[]; nightOnly: boolean }>> = {
  off: { metrics: [], nightOnly: false },
  dry: { metrics: ['temperature', 'humidity'], nightOnly: true },
  breed: { metrics: ['temperature'], nightOnly: true },
  temp: { metrics: ['temperature', 'co2'], nightOnly: false },
};

const halfOf = (
  configuration: Record<string, unknown>,
  half: 'day' | 'night',
  hardware: Record<string, string>,
  held: { metrics: readonly Metric[] } | null,
): Partial<Record<Metric, number>> => {
  const targets: Partial<Record<Metric, number>> = {};

  for (const [metric, path] of Object.entries(TARGETS[half]) as [Metric, string][]) {
    if (reportsNoSensor(hardware, metric) || (held && !held.metrics.includes(metric))) continue;
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
