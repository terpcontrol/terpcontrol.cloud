import type { DateTime } from 'luxon';
import type { Device, DeviceConfiguration, DeviceLive, Plan, PlanStep, Setpoints } from '@fg2/shared-types/v1';
import { isDayAt, lightWindowTimes, rampsAt } from '@fg2/shared-types/v1-schemas/day-night.js';
import { figureOf } from '@/ui/climate-hardware';
import { draftOf, lightsOffOf, type HeldHalves, type TargetsDraft } from './targets-draft';

/**
 * Day and night the way the firmware keeps them, for every screen that names
 * a target or sets one.
 *
 * A fridge or a tent controller decides by the clock and by nothing else: it
 * compares the time of day in UTC with the two times its document holds, and
 * between "on" and "off" it is day - the lamp ramps up to its limit, the day's
 * figures hold and CO2 is dosed - and otherwise it is night. Whether the lamp
 * really shines meanwhile (a limit of 0 %, a lamp held off, a lamp the heat
 * dimmed) changes nothing about which figures hold. Drying and germination have
 * no day at all, and an AIR fan's day is whatever its light sensor sees.
 */

export type Half = 'day' | 'night';

/**
 * What a device's day is made of, by the mode it runs and its light schedule:
 * the shape of the targets table, and what every target on every other screen
 * is called.
 *
 * - `cycle`: a day and a night by the light schedule.
 * - `always`: 24 hours of light. Only the day's figures hold; the night's are
 *   kept for when there is a night again.
 * - `never`: no hours of light. Only the night's figures hold, in the dark.
 * - `drying`, `germination`: no day at all - the night's figures, held round
 *   the clock in the dark. Germination holds only the temperature.
 * - `sensor`: an AIR fan, whose day is whatever its light sensor sees.
 * - `off`: control is switched off and nothing is held.
 */
export type Regime = 'cycle' | 'always' | 'never' | 'drying' | 'germination' | 'sensor' | 'off';

export interface Shape {
  regime: Regime;
  /** Greenhouse mode: the temperature is held, the humidity is not. */
  greenhouse: boolean;
  /** Germination with a humidifier socket that holds the night's humidity: the one humidity held in the dark. */
  humidified?: boolean;
}

/**
 * The shape a device's targets have. `drying` and `germination` are the spells
 * as the edit stands - the chip tapped last starts or ends one before it is
 * saved - and the light hours are the draft's, so 24 hours typed in is a day
 * without a night at once.
 */
export const shapeOf = (
  device: Device,
  draft: TargetsDraft,
  {
    drying = device.control?.drying ?? false,
    germination = device.control?.mode === 'germination',
    climateOnly = device.type === 'fan',
    humidified = false,
  }: { drying?: boolean; germination?: boolean; climateOnly?: boolean; humidified?: boolean } = {},
): Shape => {
  const greenhouse = device.control?.mode === 'greenhouse';
  if (climateOnly) return { regime: 'sensor', greenhouse: false };
  if (device.control?.running === false) return { regime: 'off', greenhouse };
  if (drying) return { regime: 'drying', greenhouse: false };
  if (germination) return { regime: 'germination', greenhouse: false, humidified };
  if (draft.lightHours >= 24) return { regime: 'always', greenhouse };
  if (draft.lightHours <= 0) return { regime: 'never', greenhouse };
  return { regime: 'cycle', greenhouse };
};

/** The shape of what a device runs now, from its stored document. */
export const storedShapeOf = (device: Device | null): Shape | null =>
  device?.configuration && device.type !== 'light' && device.type !== 'plug' ? shapeOf(device, draftOf(device.configuration)) : null;

/** The columns a regime's table has, in the order they stand. */
export const halvesOf = (regime: Regime): Half[] => {
  switch (regime) {
    case 'cycle':
    case 'sensor':
      return ['day', 'night'];
    case 'always':
      return ['day'];
    case 'off':
      return [];
    default:
      return ['night'];
  }
};

/** Whether the regime has a light schedule to set and a lamp and CO2 by day. */
export const hasSchedule = (regime: Regime): boolean => regime === 'cycle' || regime === 'always' || regime === 'never';

/** Whether the regime has a day in which the lamp shines and CO2 is dosed. */
export const hasDay = (regime: Regime): boolean => regime === 'cycle' || regime === 'always';

/**
 * Whether the humidity is held: not in greenhouse mode, and not by germination,
 * which holds a temperature alone - unless a humidifier socket goes on holding
 * the night's humidity there, as the grower chose.
 */
export const holdsHumidity = (shape: Shape): boolean => !shape.greenhouse && (shape.regime !== 'germination' || shape.humidified === true);

/** Where the figures of a save come from (`HeldHalves`). */
export const heldOf = (regime: Regime): HeldHalves => (regime === 'drying' ? 'drying' : 'both');

/* ------------------------------------------------------------------ the clock */

/** The time of day in UTC, in seconds: the firmware's own clock. */
export const utcSecondsOf = (now: DateTime): number => {
  const utc = now.toUTC();
  return utc.hour * 3600 + utc.minute * 60 + utc.second;
};

/**
 * Where in its day the device is.
 *
 * `sunrise` and `sunset` are the dimming ramps inside the day: the lamp is on
 * its way up or down, and a fridge glides its targets between the night's and
 * the day's figures meanwhile.
 */
export type Phase = 'day' | 'night' | 'sunrise' | 'sunset';

export interface Ramps {
  up: number;
  down: number;
}

/** Minutes of each dimming ramp, the firmware's 15 where the document says nothing. */
export const rampsOf = (configuration: DeviceConfiguration | null): Ramps => ({
  up: (configuration && figureOf(configuration, 'lights', 'sunrise')) ?? 15,
  down: (configuration && figureOf(configuration, 'lights', 'sunset')) ?? 15,
});

/**
 * The ramps a device really runs for a draft's schedule. A tent controller
 * whose window runs past midnight UTC never ramps up in the morning - its
 * firmware works the sunset out without wrapping round midnight and that
 * branch wins - so its lamp comes on hard and is drawn so.
 */
export const rampsFor = (device: Device, configuration: DeviceConfiguration | null, draft: TargetsDraft): Ramps => {
  const ramps = rampsOf(configuration);
  const { day, night } = lightWindowTimes(draft);
  return device.type === 'controller' && day > night ? { ...ramps, up: 0 } : ramps;
};

/**
 * The phase a draft's schedule puts the device in at `now`, worked out from
 * the two times the draft is written as and with the firmware's own arithmetic
 * (`day-night.ts` in the contract): strict comparisons, a window past midnight
 * UTC wrapping round it, a day that never ends being day on every second, and
 * ramps that do not go round the clock. While a fridge's ramps overlap it is
 * the morning one it glides along.
 */
export const phaseOf = (draft: TargetsDraft, ramps: Ramps, now: DateTime): Phase => {
  const cycle = { ...lightWindowTimes(draft), sunrise: ramps.up, sunset: ramps.down, workmode: null, glides: false };
  const t = utcSecondsOf(now);
  if (!isDayAt(cycle, t)) return 'night';
  const { sunrise, sunset } = rampsAt(cycle, t);
  return sunrise < 1 ? 'sunrise' : sunset < 1 ? 'sunset' : 'day';
};

/** The half a phase holds: a ramp is part of the day it belongs to. */
export const halfOf = (phase: Phase): Half => (phase === 'night' ? 'night' : 'day');

/* ------------------------------------------------------------- what holds now */

/** What the server answers for the targets a device holds now: whose half, by its clock and mode, and whether it is changing over. */
export const setpointsOf = (live: DeviceLive | undefined | null): Setpoints | null => live?.setpoints ?? null;

/**
 * Which column holds now, and on whose word.
 *
 * - `device`: what the server answers for a device that is heard - which half
 *   the device is in by its clock and mode.
 * - `schedule`: worked out from the stored schedule the way the firmware
 *   works it out, for a device that is not heard from (or whose answer has not
 *   come yet): what it would be running, not what it is known to run.
 */
export interface NowHolding {
  half: Half | null;
  by: 'device' | 'schedule';
  /** A fridge gliding between its halves over a dimming ramp: towards which, and until when. */
  glide: { to: Half; until: string } | null;
}

/** "08:15": seconds past midnight UTC as a wall-clock time, given how far the wall clock is ahead of UTC. */
type Clock = (seconds: number) => string;

export const nowHoldingOf = ({
  device,
  shape,
  stored,
  live,
  offline,
  awaiting = false,
  now,
  clock,
}: {
  device: Device;
  shape: Shape;
  /** What the device runs: the stored document as a draft. */
  stored: TargetsDraft;
  live: DeviceLive | undefined | null;
  offline: boolean;
  /**
   * The device's word is on its way for a device that is heard: the schedule
   * stands in for it meanwhile, without calling itself the schedule for the
   * moment it takes - the same read is the one the cockpit already made.
   */
  awaiting?: boolean;
  now: DateTime;
  /** Seconds past midnight UTC on the account's wall clock. */
  clock: Clock;
}): NowHolding => {
  const said = offline ? null : setpointsOf(live);
  const by: NowHolding['by'] = said || (awaiting && !offline) ? 'device' : 'schedule';
  const { regime } = shape;
  if (regime === 'off') return { half: null, by, glide: null };
  if (regime === 'always') return { half: 'day', by, glide: null };
  if (regime === 'never' || regime === 'drying' || regime === 'germination') return { half: 'night', by, glide: null };

  const ramps = rampsFor(device, device.configuration, stored);
  const phase = regime === 'cycle' ? phaseOf(stored, ramps, now) : null;
  const local = phase ? halfOf(phase) : null;
  const half = said ? (said.period === 'day' || said.period === 'night' ? said.period : said.active) : local;

  // A tent controller switches its targets at once; a fridge glides them over the ramps.
  // The server's transition runs on for the hour the climate is given after the
  // switch; only while the targets are still on the move is it a glide, and it
  // glides until the ramp ends - the lamp's switch - rather than until then.
  // Where the answer says nothing of a transition at all (not even none), or
  // there is no answer, the stored ramps say it.
  let glide: NowHolding['glide'] = null;
  if (device.type === 'fridge' && half !== null) {
    const gliding = said?.transition?.gliding ? said.transition.to : null;
    if (gliding) {
      glide = { to: gliding, until: clock(gliding === 'day' ? stored.lightsOn + ramps.up * 60 : lightsOffOf(stored)) };
    } else if (said?.transition === undefined && local === half && (phase === 'sunrise' || phase === 'sunset')) {
      glide = phase === 'sunrise' ? { to: 'day', until: clock(stored.lightsOn + ramps.up * 60) } : { to: 'night', until: clock(lightsOffOf(stored)) };
    }
  }

  return { half, by, glide };
};

/* ------------------------------------------------------------------ the plan */

/** A figure of the draft, by the name the page keeps it under. */
export type Field = keyof TargetsDraft;

/** Where each figure stands in the firmware's document. */
const PLACES: Record<Field, [string, string]> = {
  dayTemperature: ['day', 'temperature'],
  dayHumidity: ['day', 'humidity'],
  nightTemperature: ['night', 'temperature'],
  nightHumidity: ['night', 'humidity'],
  lightLimit: ['lights', 'limit'],
  lightsOn: ['daynight', 'day'],
  lightHours: ['daynight', 'night'],
  co2: ['co2', 'target'],
};

/** The step a running plan stands on, which is what puts its figures back every hour. */
export const runningStep = (plan: Plan | undefined): PlanStep | null =>
  plan?.state.status === 'running' ? (plan.steps[plan.state.activeStepIndex] ?? null) : null;

/**
 * The figures a plan's step writes, and so puts back within the hour: the ones
 * its settings carry, and the light hours where it names them. A step that
 * names light hours keeps the hour the light comes on unless its own settings
 * carry one - which a recipe migrated from the old app does, as two fixed times
 * of day - so the time a grower moves the light to is theirs to keep otherwise.
 */
export const ownedBy = (step: PlanStep | null): ReadonlySet<Field> => {
  const owned = new Set<Field>();
  if (!step) return owned;
  for (const [field, [section, key]] of Object.entries(PLACES) as [Field, [string, string]][]) {
    if (figureOf(step.settings, section, key) !== null) owned.add(field);
  }
  if (step.lightHours !== null && step.lightHours !== undefined) owned.add('lightHours');
  return owned;
};

/** The figures that differ between two drafts. */
export const changedFields = (draft: TargetsDraft, against: TargetsDraft): Field[] =>
  (Object.keys(PLACES) as Field[]).filter(field => draft[field] !== against[field]);
