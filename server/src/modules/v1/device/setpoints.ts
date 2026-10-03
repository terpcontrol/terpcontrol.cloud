import type { CardTransition, Metric, Setpoints, SetpointsTransition } from '@fg2/shared-types/v1';
import { TARGET_BAND } from '@fg2/shared-types/v1-schemas';
import { cycleAt, cycleOf, glidingTarget, type CycleMoment } from '@fg2/shared-types/v1-schemas/day-night.js';
import { reportsNoSensor } from '@common/v1/sentinels';
import { DAY_ONLY } from '@common/v1/steering';

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
 * Whose figures hold now is worked out the way the device works it out.
 *
 * A fridge and a tent controller report no day of their own: they compare the
 * UTC clock with the light schedule in their document, and their work mode
 * decides whether there is a day at all (`day-night.ts`). Reading it off the
 * light output instead - which is what was done - judged a tent against its
 * night whenever the lamp was dark in the day: a limit of 0 %, a lamp held off,
 * a lamp the heat dimmed, while the fridge went on heating to its day target.
 * An AIR fan does say, from its light sensor, and `sensorDay` is that word; a
 * fan that has not said it answers no setpoints at all, because a band nobody
 * can say which half of belongs to is worse than none. Nor does a device that
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
  sensorDay: boolean | null,
  hardware: Record<string, string> = {},
  type: string | null = null,
  at: Date = new Date(),
): Setpoints | null => {
  if (!configuration) return null;

  const cycle = cycleOf(type ?? '', configuration);
  const moment = cycle ? cycleAt(cycle, at.getTime()) : null;
  // Switched off - or in a mode the firmware does not know, which it runs as off - nothing is held.
  if ((!moment && sensorDay === null) || moment?.kind === 'off') return null;

  const held = type === 'fan' ? (FAN_HOLDS[Number(configuration.mode)] ?? null) : (HELD[String(configuration.workmode)] ?? null);
  const day = held?.nightOnly ? {} : halfOf(configuration, 'day', hardware, held);
  const night = halfOf(configuration, 'night', hardware, held);
  if (Object.keys(day).length + Object.keys(night).length === 0) return null;

  if (!moment) {
    const active = sensorDay ? 'day' : 'night';
    return { day, night, active, period: active, cycle: 'sensor', since: null, until: null, transition: null };
  }

  return {
    day,
    night,
    active: moment.active,
    period: moment.period,
    cycle: moment.kind as Exclude<typeof moment.kind, 'off'>,
    since: instantOf(moment.since),
    until: instantOf(moment.until),
    transition: transitionOf(moment, day, night),
  };
};

const instantOf = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

/**
 * The change between the halves as the screens are told it, with what the
 * device aims at meanwhile: the gliding figures of a fridge, worked out as its
 * firmware works them out, and the new half's once they have arrived. A metric
 * the new half holds no target for - CO2 into the night - is not aimed at.
 */
const transitionOf = (
  moment: CycleMoment,
  day: Partial<Record<Metric, number>>,
  night: Partial<Record<Metric, number>>,
): SetpointsTransition | null => {
  const transition = moment.transition;
  if (!transition) return null;

  const to = transition.to === 'day' ? day : night;
  const targets = Object.fromEntries(
    (Object.entries(to) as [Metric, number][]).flatMap(([metric, value]) => {
      if (DAY_ONLY.includes(metric) && transition.to === 'night') return [];
      const other = night[metric];
      const glides = transition.glide !== null && !DAY_ONLY.includes(metric) && day[metric] !== undefined && other !== undefined;
      return [[metric, glides ? round(glidingTarget(day[metric]!, other, transition.glide!)) : value]];
    }),
  ) as Partial<Record<Metric, number>>;

  return { from: transition.from, to: transition.to, until: new Date(transition.until).toISOString(), gliding: transition.glide !== null, targets };
};

/**
 * What counts as on target for one metric while the device changes halves: a
 * reading anywhere from the lower half's band to the higher one's. A half that
 * holds no target for the metric leaves nothing to judge it by until the change
 * is over.
 */
export const cardTransitionOf = (setpoints: Setpoints, metric: Metric): CardTransition | null => {
  const transition = setpoints.transition;
  if (!transition) return null;

  const band = TARGET_BAND[metric];
  const ends = [setpoints.day[metric], DAY_ONLY.includes(metric) ? undefined : setpoints.night[metric]];
  const known = ends.every((value): value is number => value !== undefined) && band !== undefined;

  return {
    from: transition.from,
    to: transition.to,
    until: transition.until,
    low: known ? round(Math.min(...(ends as number[])) - band) : null,
    high: known ? round(Math.max(...(ends as number[])) + band) : null,
  };
};

const round = (value: number): number => Math.round(value * 10) / 10;

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

/**
 * What an AIR fan holds by its mode, the firmware's number for it: at a fixed
 * speed (0) it follows no reading at all, and it follows the temperature (1),
 * the humidity (2) or both (3). Its CO2 is never a target of its own.
 */
const FAN_HOLDS: Readonly<Record<number, { metrics: readonly Metric[]; nightOnly: boolean }>> = {
  0: { metrics: [], nightOnly: false },
  1: { metrics: ['temperature'], nightOnly: false },
  2: { metrics: ['humidity'], nightOnly: false },
  3: { metrics: ['temperature', 'humidity'], nightOnly: false },
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
