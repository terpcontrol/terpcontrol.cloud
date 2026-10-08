import { Box, Fan, Leaf, Refrigerator, Sun, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import type {
  CardSetpoint,
  CardValue,
  ClimateVerdict,
  Device,
  DeviceLive,
  Metric,
  OpenAlert,
  OutputMetric,
  OverviewCamera,
  OverviewTargets,
  SeriesPoint,
  Socket,
  SpaceKind,
  TimelineOutputLane,
  TimelinePanel,
  TimelineSpan,
  TimelineTarget,
} from '@fg2/shared-types/v1';
import { germinationChoicesOf } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { switchPointName, workModeOf, type PlugMode, type PlugSwitching } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { lightsOffOf, roundTheClock, utcSecondsOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { STEERED, TARGET_BAND, type Steered } from '@fg2/shared-types/v1-schemas/steering.js';
import { timelinePath } from '@/app/places';
import { fieldValue } from '@/ui/advanced/field-values';
import { offlineLabel, sinceLabel, valueAge } from '@/ui/age';
import { figureOf, statesTargets } from '@/ui/climate-hardware';
import type { Quiet } from '@/ui/maintenance';
import { clock } from '@/ui/zone';
import { nowHoldingOf, setpointsOf, storedShapeOf, type Half, type NowHolding, type Regime } from '../control/targets/day-night';
import type { ConstantHold } from '../timeline/window';
import { hoursWritten } from '../control/targets/schedule-words';
import { draftOf, offsetOf, wallClock } from '../control/targets/targets-draft';
import { livenessOf, measuredAtOf, worstAlertOf, type Liveness } from '../home/attention';
import { alertLabel, asWritten, figure, isSilence, UNIT } from '../home/units';
import { plugModeOf } from '../control/devices/own-summary';

/**
 * What a place's cockpit decides before it draws anything: which device holds
 * the climate, what each tile says about its reading, which outputs move it and
 * what one sentence opens the page. All of it is arithmetic over answers the
 * screen already holds, so the cockpit and the cards of a several-place Start
 * say the same thing about the same tent.
 */

/** The tiles a cockpit can draw, in the order it draws them. `leaf` is the tent's leaf-and-light tile, which reads two sensors. */
export type TileKey = 'temperature' | 'humidity' | 'light' | 'co2' | 'leaf';

/**
 * The device that holds the place's climate: the first one whose document
 * states targets, else the first one standing there. Its document says when the
 * light comes on and its outputs are the ones a tile lists; a second device in
 * the same tent is read through the place's merged values like any other.
 */
export const climateDeviceOf = (devices: Device[] | undefined, deviceIds: readonly string[] | null): Device | null => {
  const here = (devices ?? []).filter(device => deviceIds?.includes(device.id));
  // An AIR fan states a temperature and a humidity too, but it follows the
  // tent's controller rather than standing for it: it has no lamp and no CO2.
  return (
    here.find(device => statesTargets(device.configuration) && device.type !== 'fan') ??
    here.find(device => statesTargets(device.configuration)) ??
    here[0] ??
    null
  );
};

export const valueOf = (values: CardValue[], metric: Metric): CardValue | null =>
  values.find(value => value.metric === metric && value.value !== null) ?? null;

export const KIND_ICON: Record<SpaceKind, LucideIcon> = { tent: Box, fridge: Refrigerator, room: Fan, balcony: Sun, other: Leaf };

/** Where a tile opens the Timeline: on its reading's panel, or on the lamp's lane. */
const FOCUS: Record<TileKey, string> = { temperature: 'temperature', humidity: 'humidity', light: 'light', co2: 'co2', leaf: 'leafTemperature' };

/**
 * The Timeline, scrolled to what a tile is about. The leaf tile leads with the
 * light where nothing measures the leaf, and opens on the panel it leads with.
 */
export const focusLink = (spaceId: string, key: TileKey, values: CardValue[] = []): string =>
  timelinePath(spaceId, key === 'leaf' && valueOf(values, 'leafTemperature') === null && valueOf(values, 'lux') !== null ? 'lux' : FOCUS[key]);

/** Whether this place reports the reading a tile is about. Light is the climate device's own output and needs a document to say its window. */
export const reports = (values: CardValue[], key: TileKey): boolean => {
  if (key === 'light') return true;
  if (key === 'leaf') return valueOf(values, 'leafTemperature') !== null || valueOf(values, 'lux') !== null;
  return valueOf(values, key) !== null;
};

/**
 * What a tile says about its reading. `last` replaces a verdict once the value
 * is no longer live: a green "in band" under a figure from an hour ago would be
 * a claim about a tent nobody has heard from since.
 */
export type Verdict =
  | { kind: 'in' }
  | { kind: 'high' | 'low'; delta: number }
  | { kind: 'last'; at: string | null }
  /** Changing between day and night: on its way from one half's band to the other's, given until `until`. */
  | { kind: 'settling'; until: string }
  | null;

export const verdictOf = (value: CardValue | null, setpoint: CardSetpoint | null, now: DateTime): Verdict => {
  if (!value || value.value === null) return null;
  if (valueAge(value, now) !== 'live') return { kind: 'last', at: value.measuredAt };
  if (setpoint?.value == null || setpoint.band == null) return null;
  // Judged on the difference as it is written: 22.04 °C against 21 ± 1 was
  // "1,0 °C zu hoch" beside a help text that says ±1 °C is in target, and the
  // status line flipped on every sample that crossed a rounding edge.
  const delta = value.value - setpoint.value;
  const off = asWritten(Math.abs(delta), value.metric);
  if (off <= setpoint.band) return { kind: 'in' };

  // For the hour after a switch between day and night - and while a fridge
  // glides along its ramp before it - anything between the two halves' bands
  // is on target, as the server judges it: a fridge cooling into its night is
  // on its way there and not "zu warm". It is said as that rather than as "im
  // Ziel" beside a target it has not reached. Where one half holds no target
  // (CO2 at night) nothing is judged until the hour is over.
  const transition = setpoint.transition;
  if (transition) {
    if (transition.low === null || transition.high === null) return { kind: 'settling', until: transition.until };
    if (value.value >= transition.low && value.value <= transition.high) return { kind: 'settling', until: transition.until };
  }
  return { kind: delta > 0 ? 'high' : 'low', delta: off };
};

export const setpointOf = (setpoints: CardSetpoint[], metric: Metric): CardSetpoint | null =>
  setpoints.find(setpoint => setpoint.metric === metric) ?? null;

/**
 * The humidity a humidifier socket holds while the device germinates (owner's
 * decision G3): the night's, from below alone. The socket switches on a band
 * under the figure and adds moisture up to it, and nothing in the dark takes
 * any out. The server holds germination to its temperature alone and sends no
 * humidity target, so without this the cockpit said "Alles im Ziel" over a box
 * at 58 % whose humidifier was to hold 80 % - an empty tank, unnoticed.
 */
export interface HumidifierHold {
  target: number;
  /** How far under the figure still counts as held: the band every humidity target is judged by (`TARGET_BAND`). */
  band: number;
}

/** What a humidifier holds now, or null: the device does not germinate, has no humidifier paired, or the grower lets it rest. */
export const humidifierHoldOf = (device: Device | null, humidifierPaired: boolean): HumidifierHold | null => {
  if (!humidifierPaired || darkReasonOf(device) !== 'germination' || !device?.configuration) return null;
  if (!germinationChoicesOf(device.control?.germinationChoices).humidifierHolds) return null;
  const target = figureOf(device.configuration, 'night', 'humidity');
  return target === null ? null : { target, band: TARGET_BAND.humidity! };
};

/**
 * A humidity a humidifier holds, judged from below: under its band by how far
 * under the figure it reads, up to the band above it in band, and above that
 * nothing - no output here can dry the box, and seeds are kept wet on purpose,
 * which "Zu feucht" watches over where the grower asked it to.
 */
export const holdVerdictOf = (value: CardValue | null, hold: HumidifierHold, now: DateTime): Verdict => {
  if (!value || value.value === null) return null;
  if (valueAge(value, now) !== 'live') return { kind: 'last', at: value.measuredAt };
  const under = asWritten(hold.target - value.value, value.metric);
  if (under > hold.band) return { kind: 'low', delta: under };
  return under >= -hold.band ? { kind: 'in' } : null;
};

/** A reading's verdict, by the humidity a humidifier holds where the device names no target for it. */
export const judgedOf = (value: CardValue | null, setpoint: CardSetpoint | null, hold: HumidifierHold | null, now: DateTime): Verdict =>
  hold && value?.metric === 'humidity' && setpoint?.value == null ? holdVerdictOf(value, hold, now) : verdictOf(value, setpoint, now);

/**
 * A day of one reading with the band the cockpit judges it by.
 *
 * The Timeline's bands are what the controller aimed at, change by change, in
 * the mode it ran - the server's record, which is also what the status line and
 * its "seit 18:02" are worked out against - so a panel that carries them is
 * drawn as it came: a drying room's band through the whole of its day, the hour
 * after a change reaching over what held before. Only a panel with no band at
 * all borrows the controller's configuration as it stands now, day and night,
 * or the one climate it holds round the clock (`held`).
 */
export const judgedPanel = (
  panel: TimelinePanel | null,
  targets: OverviewTargets | null,
  startsAt: string,
  endsAt: string,
  held: ConstantHold | null = null,
): TimelinePanel | null => {
  if (!panel || !targets || panel.targets.length > 0) return panel;
  const half = (row: CardSetpoint[]): TimelineTarget | null => {
    const setpoint = setpointOf(row, panel.metric);
    return setpoint?.value == null || setpoint.band == null
      ? null
      : { setpoint: setpoint.value, band: { low: setpoint.value - setpoint.band, high: setpoint.value + setpoint.band } };
  };
  const day = half(targets.day);
  const night = half(targets.night);
  if (!day && !night) return panel;

  return { ...panel, targets: [{ startsAt, endsAt, phaseId: null, stage: null, day, night, ...(held ? { held } : {}) }] };
};

/** The one climate a regime holds round the clock, as the Timeline names it; null for a day and a night. */
export const constantHoldOf = (regime: Regime | null): ConstantHold | null => {
  switch (regime) {
    case 'drying':
      return 'drying';
    case 'germination':
      return 'germination';
    case 'always':
      return 'always_day';
    case 'never':
      return 'always_night';
    default:
      return null;
  }
};

/**
 * The outputs that move each reading, by kind of hardware, in the order a tile
 * lists them. A fridge module drives one compressor that both cools and dries,
 * on the output the firmware calls the dehumidifier, so it stands under both
 * readings and is called the compressor under both: one machine, one name. A
 * tent controller cannot cool at all, so its temperature lists the heater and
 * nothing that would promise otherwise.
 */
const MOVERS: Record<string, Partial<Record<Steered, OutputMetric[]>>> = {
  fridge: { temperature: ['dehumidifier', 'heater'], humidity: ['dehumidifier'], co2: ['co2'] },
  controller: { temperature: ['heater'], humidity: ['dehumidifier'], co2: ['co2'] },
};

/** The catalogue word an output is called by everywhere on the cockpit. */
export type OutputWord = 'compressor' | 'heater' | 'dehumidifier' | 'co2' | 'socket' | 'humidifier';

/** The reading a stand-alone smart socket switches by, per mode, and the names of its two points. */
const PLUG_FOLLOWS: Partial<Record<PlugMode, Steered>> = {
  heater: 'temperature',
  cooler: 'temperature',
  humidify: 'humidity',
  dehumidify: 'humidity',
  co2: 'co2',
};

/** Between the two points a socket switches at, which is the range it holds its reading in. */
export interface SwitchRange {
  low: number;
  high: number;
}

/**
 * The range a stand-alone smart socket holds a reading in: its switch points
 * for the half of the day it is in, where it switches by that reading. A
 * socket has no targets, and its tiles said "kein Ziel" under a temperature it
 * was heating to all along.
 */
export const switchRangeOf = (device: Device | null, metric: Steered, now: DateTime): SwitchRange | null => {
  const mode = plugModeOf(device);
  if (!device || !mode || PLUG_FOLLOWS[mode] !== metric) return null;

  const night = fieldValue(device, 'dayNight') === true && mode !== 'co2' && isNightFor(device, now);
  const point = (edge: 'on' | 'off'): number | null => {
    const value = fieldValue(
      device,
      mode === 'co2' ? `co2${edge === 'on' ? 'On' : 'Off'}` : switchPointName(mode as PlugSwitching, night ? 'night' : 'day', edge),
    );
    return typeof value === 'number' ? value : null;
  };
  const on = point('on');
  const off = point('off');
  return on === null || off === null ? null : { low: Math.min(on, off), high: Math.max(on, off) };
};

/** Whether a socket that keeps night points of its own is in its night now, by the times of day its document keeps. */
const isNightFor = (device: Device, now: DateTime): boolean => {
  const day = fieldValue(device, 'dayFrom');
  const night = fieldValue(device, 'nightFrom');
  if (typeof day !== 'number' || typeof night !== 'number' || day === night) return false;
  const second = utcSecondsOf(now.toMillis());
  return day < night ? second < day || second >= night : second >= night && second < day;
};

/** What a tile says about a reading a socket holds between two points: in range, or how far past the nearer one. */
export const rangeVerdictOf = (value: CardValue | null, range: SwitchRange, now: DateTime): Verdict => {
  if (!value || value.value === null) return null;
  if (valueAge(value, now) !== 'live') return { kind: 'last', at: value.measuredAt };
  if (value.value > range.high) return { kind: 'high', delta: asWritten(value.value - range.high, value.metric) };
  if (value.value < range.low) return { kind: 'low', delta: asWritten(range.low - value.value, value.metric) };
  return { kind: 'in' };
};

const wordOf = (device: Device, output: OutputMetric): OutputWord | null => {
  if (output === 'dehumidifier') return device.type === 'fridge' ? 'compressor' : 'dehumidifier';
  return output === 'heater' || output === 'co2' ? output : null;
};

export interface OutputState {
  /** The output, or `humidifier` for the sockets paired as one, which report through the socket table rather than as an output. */
  output: OutputMetric | 'humidifier';
  word: OutputWord;
  on: boolean;
  /** Since when it has been running, where the day's record says so. */
  since: string | null;
}

/**
 * What the hardware is doing about one reading, from the device's own newest
 * report. An output the device has never reported is left out rather than
 * called off, and so is the CO2 valve of a controller with no sensor, which the
 * firmware never opens.
 */
export const outputsFor = (
  device: Device | null,
  live: DeviceLive | undefined,
  lanes: TimelineOutputLane[] | undefined,
  metric: Steered,
): OutputState[] => {
  if (!device || !live) return [];
  // A stand-alone socket moves the reading it switches by with its one relay.
  const mode = plugModeOf(device);
  if (mode) {
    const level = live.outputs.relais?.value;
    if (PLUG_FOLLOWS[mode] !== metric || level === null || level === undefined) return [];
    const lane = lanes?.find(one => one.output === 'relais' && (one.deviceId === null || one.deviceId === device.id));
    return [{ output: 'relais', word: 'socket', on: level > 0, since: level > 0 ? runningSince(lane) : null }];
  }
  return (MOVERS[device.type]?.[metric] ?? []).flatMap(output => {
    const word = wordOf(device, output);
    const level = live.outputs[output]?.value;
    if (!word || level === null || level === undefined) return [];
    if (output === 'co2' && device.state?.hardware?.co2 === 'off') return [];
    const on = level > 0;
    const lane = lanes?.find(one => one.output === output && (one.deviceId === null || one.deviceId === device.id));
    return [{ output, word, on, since: on ? runningSince(lane) : null }];
  });
};

/**
 * The humidifier sockets paired at a device, under the humidity they move:
 * one name for all of them, on while any is on, and since when where the one
 * that is on says so. A socket whose state the device has not reported is
 * left out rather than called off.
 */
export const humidifierOutputs = (sockets: readonly Socket[], metric: Steered): OutputState[] => {
  const known = sockets.filter(socket => socket.state !== 'unknown');
  if (metric !== 'humidity' || known.length === 0) return [];
  const running = known.find(socket => socket.state === 'on');
  return [{ output: 'humidifier', word: 'humidifier', on: running !== undefined, since: running?.stateChangedAt ?? null }];
};

/** Since when the newest run of an output has gone on, where it is still going at the end of what was heard. */
export const runningSince = (lane: TimelineOutputLane | undefined): string | null => {
  const last = lane?.spans.at(-1);
  return last && lane && last.endsAt === lane.heardUntil ? last.startsAt : null;
};

/** When the lamp comes on and goes off, on the account's wall clock, as hours past midnight for a bar and as "08:00" for a sentence. */
export interface LightWindow {
  /** Hours past local midnight, fractional. */
  start: number;
  hours: number;
  on: string;
  off: string;
  /** The lamp's own maximum, in per cent. */
  limit: number;
  /** 24 hours of light: no time it goes off, and no dimming. */
  always: boolean;
  /** No hours of light: dark round the clock. */
  never: boolean;
}

/**
 * The light's window today, read out of the climate device's document. The
 * document keeps seconds past midnight UTC and the account keeps a wall clock;
 * the server moves the seconds when the clocks change, so today's offset turns
 * one into the other.
 */
/**
 * Why a device keeps its lamp dark whatever its window says, or null: switched
 * off, drying, or germinating in the dark. The window is then no promise, and
 * "08:00–20:00" over a dark fridge read as a lamp that had failed.
 */
export type DarkReason = 'off' | 'drying' | 'germination';

export const darkReasonOf = (device: Device | null): DarkReason | null => {
  const control = device?.control;
  if (!control) return null;
  if (!control.running) return 'off';
  const mode = workModeOf(control);
  return mode === 'drying' || mode === 'germination' ? mode : null;
};

export const lightWindowOf = (device: Device | null, now: DateTime, zone: string | null): LightWindow | null => {
  if (device?.type === 'light') return lampWindowOf(device, now, zone);
  if (darkReasonOf(device)) return null;
  // A fan's day is what its light sensor sees; it keeps no light window of its own.
  if (!device?.configuration || !statesTargets(device.configuration) || device.type === 'fan') return null;
  const draft = draftOf(device.configuration);
  const offset = offsetOf(now, zone);

  return {
    start: roundTheClock(draft.lightsOn + offset) / 3600,
    hours: draft.lightHours,
    on: wallClock(draft.lightsOn, offset),
    off: wallClock(lightsOffOf(draft), offset),
    limit: draft.lightLimit,
    always: draft.lightHours >= 24,
    never: draft.lightHours <= 0,
  };
};

/** A LIGHT keeps its times and its brightness at the top of its document. */
const lampWindowOf = (device: Device, now: DateTime, zone: string | null): LightWindow | null => {
  const document = device.configuration;
  const on = document?.day;
  const off = document?.night;
  if (typeof on !== 'number' || typeof off !== 'number') return null;

  const offset = offsetOf(now, zone);
  const seconds = roundTheClock(off - on);
  return {
    start: roundTheClock(on + offset) / 3600,
    hours: seconds / 3600,
    on: wallClock(on, offset),
    off: wallClock(off, offset),
    limit: typeof document?.limit === 'number' ? document.limit : 100,
    always: false,
    never: seconds === 0,
  };
};

/**
 * Which half of its day a device holds now: what the server says for a device
 * that is heard - the half its clock and its mode put it in - and, for one
 * that is not, the half its schedule puts it in, which is what it would be
 * running. Never the lamp: a lamp held off at noon, dimmed to 0 % or cut by
 * the heat leaves the device in its day, holding its day's figures.
 */
export const halfNowOf = (device: Device | null, live: DeviceLive | undefined, now: DateTime, offline: boolean): Half | null =>
  holdingNowOf(device, live, now, offline)?.half ?? null;

/**
 * The same, with how it is known - the device's word, or its schedule for one
 * not heard from - and whether a fridge is gliding its targets between the
 * halves right now.
 */
export const holdingNowOf = (device: Device | null, live: DeviceLive | undefined, now: DateTime, offline: boolean): NowHolding | null => {
  const shape = storedShapeOf(device);
  if (!device?.configuration || !shape) {
    const said = offline ? null : (setpointsOf(live)?.active ?? null);
    return said ? { half: said, by: 'device', glide: null } : null;
  }
  const stored = draftOf(device.configuration);
  return nowHoldingOf({ device, shape, stored, live, offline, now, clock: () => '' });
};

/** "12" or "12,5": the length of the day the way a person says it, in the reader's own decimals. */
export const hoursFigure = (hours: number): string => hoursWritten(hours);

/**
 * The stretches the lamp was dark, from the light output's own series: the
 * night a curve is shaded with. A lamp under one per cent counts as off, which
 * leaves a sunrise ramp to the day it belongs to.
 */
export const nightsOf = (points: SeriesPoint[] | undefined, endsAt: string): TimelineSpan[] => {
  const nights: TimelineSpan[] = [];
  let start: string | null = null;
  for (const point of points ?? []) {
    if (point.value === null) continue;
    const dark = point.value < 1;
    if (dark && start === null) start = point.measuredAt;
    if (!dark && start !== null) {
      nights.push({ startsAt: start, endsAt: point.measuredAt });
      start = null;
    }
  }
  if (start !== null) nights.push({ startsAt: start, endsAt });
  return nights;
};

/** Whether a device here has had its whole control switched off. */
export const controlOffOf = (devices: Device[]): boolean => devices.some(device => device.control?.running === false);

/* ------------------------------------------------------------ the status */

/**
 * The one sentence a place opens with, worst first: gone quiet, being worked
 * on, its control switched off, an alarm, a reading off its target, readings
 * arriving late, nothing to judge against, or all in band.
 *
 * A reading off target says since when only where the day's verdict has an
 * open run outside the band, which the server names once it has lasted ten
 * minutes; before that the sentence says "just now", because a door opened
 * for a minute is not an excursion and should not read like one. A card of
 * Start is not sent the verdict, so it can tell neither: it says how far off
 * the reading is and nothing about how long, rather than "just now" beside a
 * cockpit that says "since 18:02" about the same tent.
 */
export type Status =
  | { kind: 'offline'; since: string | null }
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'maintenance'; quiet: Quiet }
  | { kind: 'controlOff' }
  | { kind: 'alert'; alert: OpenAlert }
  /** `since` is null for a run too short to count yet, and undefined where no verdict was at hand to say. */
  | { kind: 'off'; metric: Steered; high: boolean; delta: number; since?: string | null }
  | { kind: 'stale'; at: string | null }
  | { kind: 'noTargets' }
  | { kind: 'good' };

export interface StatusInput {
  values: CardValue[];
  setpoints: CardSetpoint[];
  deviceIds: string[] | null;
  openAlerts: OpenAlert[];
  /** The day's verdict, which the cockpit reads and a card of Start is not sent. */
  verdict?: ClimateVerdict | null;
  quiet: Quiet | null;
  /** A device here has its whole control switched off, which every reading after it is explained by. */
  controlOff?: boolean;
  /** The humidity a humidifier holds while the device germinates, which the server names no target for. */
  humidifierHold?: HumidifierHold | null;
}

export const statusOf = (place: StatusInput, now: DateTime): Status => {
  const liveness: Liveness = livenessOf(place, now);
  // A place with no sensor can still have something open: a camera that stopped delivering is its one way to go wrong.
  if (liveness === 'none') {
    const alert = worstAlertOf({ openAlerts: place.openAlerts.filter(one => !isSilence(one)) });
    return alert ? { kind: 'alert', alert } : { kind: 'none' };
  }
  if (liveness === 'offline') return place.values.length === 0 ? { kind: 'waiting' } : { kind: 'offline', since: measuredAtOf(place.values) };
  if (place.quiet) return { kind: 'maintenance', quiet: place.quiet };
  if (place.controlOff) return { kind: 'controlOff' };

  const alert = worstAlertOf({ openAlerts: place.openAlerts.filter(one => !isSilence(one)) });
  if (alert) return { kind: 'alert', alert };

  const off = STEERED.flatMap(metric => {
    const setpoint = setpointOf(place.setpoints, metric);
    const hold = metric === 'humidity' && setpoint?.value == null ? (place.humidifierHold ?? null) : null;
    const verdict = judgedOf(valueOf(place.values, metric), setpoint, hold, now);
    if (verdict?.kind !== 'high' && verdict?.kind !== 'low') return [];
    const band = hold?.band ?? setpoint?.band ?? 1;
    return [{ metric, high: verdict.kind === 'high', delta: verdict.delta, weight: verdict.delta / band, held: hold !== null }];
  }).sort((one, other) => other.weight - one.weight)[0];

  if (off) {
    const status = { kind: 'off' as const, metric: off.metric, high: off.high, delta: off.delta };
    // The day's verdict knows no humidity germination does not hold, so how long it has been under says nothing.
    if (!place.verdict || off.held) return status;
    const run = place.verdict.metrics
      .find(row => row.metric === off.metric)
      ?.excursions.find(excursion => excursion.endedAt === null && excursion.above === off.high);
    return { ...status, since: run?.startedAt ?? null };
  }

  if (liveness === 'stale') return { kind: 'stale', at: measuredAtOf(place.values) };
  if (!place.setpoints.some(setpoint => setpoint.value !== null)) return { kind: 'noTargets' };

  return { kind: 'good' };
};

/** The tone a status is drawn in. */
export const toneOf = (status: Status): 'good' | 'warn' | 'alarm' | 'quiet' => {
  switch (status.kind) {
    case 'good':
      return 'good';
    case 'alert':
      return status.alert.severity === 'critical' ? 'alarm' : 'warn';
    case 'offline':
      return 'alarm';
    case 'off':
    case 'stale':
    case 'maintenance':
    case 'controlOff':
      return 'warn';
    default:
      return 'quiet';
  }
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The status in words, the same on the cockpit and on a place's card. */
export const statusText = (t: Translate, status: Status, now: DateTime, zone: string | null): string => {
  switch (status.kind) {
    case 'offline':
      return offlineLabel(status.since, now, zone, true);
    case 'none':
      return t('home.invite.noSensor');
    case 'off': {
      const words = t(`cockpit.status.${status.high ? 'high' : 'low'}${status.since === null ? 'Now' : ''}`, {
        metric: t(`cockpit.metric.${status.metric}`),
        delta: `${figure(status.delta, status.metric)} ${UNIT[status.metric] ?? ''}`.trim(),
      });
      return status.since ? `${words} · ${t('cockpit.status.since', { time: sinceLabel(status.since, now, zone) })}` : words;
    }
    case 'alert':
      return `${alertLabel(t, status.alert, now, zone)} · ${t('cockpit.status.since', { time: sinceLabel(status.alert.startedAt, now, zone) })}`;
    case 'maintenance':
      return status.quiet.parked
        ? t('cockpit.status.maintenance', { until: clock(status.quiet.until, zone) })
        : t('cockpit.status.settling', { until: clock(status.quiet.alarmsUntil, zone) });
    case 'stale':
      return t('cockpit.status.stale', { time: status.at ? sinceLabel(status.at, now, zone) : '' });
    default:
      return t(`cockpit.status.${status.kind}`);
  }
};

/* ------------------------------------------------------------ the picture */

/**
 * The picture a place is shown by: the newest one taken in the light. A tent
 * lit by night is dark in every hour somebody looks by day, so where the
 * newest picture is dark the newest lit one stands in, and says so.
 */
export const shownStill = (camera: OverviewCamera): { mediaId: string; capturedAt: string; dark: boolean } | null => {
  if (camera.litStill) return { ...camera.litStill, dark: true };
  const newest = camera.stills.at(-1);
  return newest ? { ...newest, dark: false } : null;
};
