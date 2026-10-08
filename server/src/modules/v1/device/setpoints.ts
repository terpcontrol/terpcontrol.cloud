import type { CardTransition, Metric, Setpoints, SetpointsTransition, TargetBand } from '@fg2/shared-types/v1';
import { figureAt } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { cycleAt, cycleOf, glidingTarget, type CycleMoment } from '@fg2/shared-types/v1-schemas/day-night.js';
import { reportsNoSensor } from '@common/v1/sentinels';
import { DAY_ONLY } from '@common/v1/steering';
import { bandAround, HELD, unionOf, type Held, type Settling } from './held-targets';

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
  // The CO2 target is one number in the document, and the device doses towards
  // it by day alone: the night holds none, and is not said to.
  day: { temperature: 'day.temperature', humidity: 'day.humidity', co2: 'co2.target' },
  night: { temperature: 'night.temperature', humidity: 'night.humidity' },
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
  /** The hour after a change of the targets or the cycle, from the device's record (`settlingOf`). */
  settling: Settling | null = null,
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
    transition: withSettling(
      transitionOf(moment, day, night),
      settlingAt(settling, at, moment.active === 'day' ? day : night),
      moment.active,
      moment.active === 'day' ? day : night,
    ),
  };
};

/**
 * The settling of a change that is still running and moved something the
 * device holds now: a band before that is not the band of now. A change of the
 * light schedule alone, inside the same half, leaves nothing to follow.
 */
const settlingAt = (settling: Settling | null, at: Date, active: Partial<Record<Metric, number>>): Settling | null => {
  if (!settling || at.getTime() >= settling.until) return null;
  const moved = (Object.entries(settling.bands) as [Metric, TargetBand | null][]).some(([metric, before]) => {
    const now = bandAround(metric, active[metric]);
    return JSON.stringify(before) !== JSON.stringify(now) && !(before === null && now === null);
  });
  return moved ? settling : null;
};

/**
 * The transition the screens are told: the schedule's between its halves, the
 * hour after a change somebody made, or both at once - the later end, and the
 * figures the schedule's glide aims at where it glides.
 */
const withSettling = (
  scheduled: SetpointsTransition | null,
  settling: Settling | null,
  active: 'day' | 'night',
  figures: Partial<Record<Metric, number>>,
): SetpointsTransition | null => {
  if (!settling) return scheduled;
  const until = new Date(Math.max(settling.until, scheduled ? Date.parse(scheduled.until) : 0)).toISOString();
  return scheduled
    ? { ...scheduled, until }
    : {
        from: settling.from,
        to: active,
        until,
        gliding: false,
        targets: Object.fromEntries(Object.entries(figures).filter(([metric]) => !(DAY_ONLY.includes(metric as Metric) && active === 'night'))),
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
export const cardTransitionOf = (
  setpoints: Setpoints,
  metric: Metric,
  settling: Settling | null = null,
  at: Date = new Date(),
): CardTransition | null => {
  const transition = setpoints.transition;
  if (!transition) return null;

  // Between the halves, both of them; within one half - a change somebody made
  // - the half that holds; and after a change, whatever held before it too.
  const now =
    transition.from !== transition.to
      ? [bandAround(metric, setpoints.day[metric]), bandAround(metric, DAY_ONLY.includes(metric) ? undefined : setpoints.night[metric])]
      : [bandAround(metric, setpoints[transition.to][metric])];
  const before = settling && at.getTime() < settling.until ? [settling.bands[metric] ?? null] : [];
  const band = unionOf([...now, ...before]);

  return {
    from: transition.from,
    to: transition.to,
    until: transition.until,
    low: band ? round(band.low) : null,
    high: band ? round(band.high) : null,
  };
};

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * What an AIR fan holds by its mode, the firmware's number for it: at a fixed
 * speed (0) it follows no reading at all, and it follows the temperature (1),
 * the humidity (2) or both (3). Its CO2 is never a target of its own.
 */
const FAN_HOLDS: Readonly<Record<number, Held>> = {
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
    const value = figureAt(configuration, path);
    if (value !== null) targets[metric] = value;
  }

  return targets;
};
