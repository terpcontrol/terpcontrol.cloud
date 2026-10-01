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
  OverviewTargets,
  SeriesPoint,
  SpaceKind,
  TimelineOutputLane,
  TimelinePanel,
  TimelineSpan,
  TimelineTarget,
} from '@fg2/shared-types/v1';
import { timelinePath } from '@/app/places';
import { offlineLabel, sinceLabel, valueAge } from '@/ui/age';
import { statesTargets } from '@/ui/climate-hardware';
import type { Quiet } from '@/ui/maintenance';
import { clock } from '@/ui/zone';
import { draftOf, lightsOffOf, offsetOf } from '../control/targets/targets-draft';
import { livenessOf, measuredAtOf, worstAlertOf, type Liveness } from '../home/attention';
import { alertLabel, figure, isSilence, UNIT } from '../home/units';

/**
 * What a place's cockpit decides before it draws anything: which device holds
 * the climate, what each tile says about its reading, which outputs move it and
 * what one sentence opens the page. All of it is arithmetic over answers the
 * screen already holds, so the cockpit and the cards of a several-place Start
 * say the same thing about the same tent.
 */

/** The tiles a cockpit can draw, in the order it draws them. `leaf` is the tent's leaf-and-light tile, which reads two sensors. */
export type TileKey = 'temperature' | 'humidity' | 'light' | 'co2' | 'leaf';

/** The three readings a target is held for, which are the ones with a band, a verdict and outputs that move them. */
export type Steered = 'temperature' | 'humidity' | 'co2';

/**
 * The device that holds the place's climate: the first one whose document
 * states targets, else the first one standing there. Its document says when the
 * light comes on and its outputs are the ones a tile lists; a second device in
 * the same tent is read through the place's merged values like any other.
 */
export const climateDeviceOf = (devices: Device[] | undefined, deviceIds: readonly string[] | null): Device | null => {
  const here = (devices ?? []).filter(device => deviceIds?.includes(device.id));
  return here.find(device => statesTargets(device.configuration)) ?? here[0] ?? null;
};

export const valueOf = (values: CardValue[], metric: Metric): CardValue | null =>
  values.find(value => value.metric === metric && value.value !== null) ?? null;

export const KIND_ICON: Record<SpaceKind, LucideIcon> = { tent: Box, fridge: Refrigerator, room: Fan, balcony: Sun, other: Leaf };

/** Where a tile opens the Timeline. The leaf has no panel of its own there, and is read against the air it is compared with. */
const FOCUS: Record<TileKey, string> = { temperature: 'temperature', humidity: 'humidity', light: 'light', co2: 'co2', leaf: 'temperature' };

export const focusLink = (spaceId: string, key: TileKey): string => timelinePath(spaceId, FOCUS[key]);

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
export type Verdict = { kind: 'in' } | { kind: 'high' | 'low'; delta: number } | { kind: 'last'; at: string | null } | null;

export const verdictOf = (value: CardValue | null, setpoint: CardSetpoint | null, now: DateTime): Verdict => {
  if (!value || value.value === null) return null;
  if (valueAge(value, now) !== 'live') return { kind: 'last', at: value.measuredAt };
  if (setpoint?.value == null || setpoint.band == null) return null;
  const delta = value.value - setpoint.value;
  if (Math.abs(delta) <= setpoint.band) return { kind: 'in' };
  return { kind: delta > 0 ? 'high' : 'low', delta: Math.abs(delta) };
};

export const setpointOf = (setpoints: CardSetpoint[], metric: Metric): CardSetpoint | null =>
  setpoints.find(setpoint => setpoint.metric === metric) ?? null;

/**
 * A day of one reading with the band the cockpit judges it by: the
 * controller's configuration as it stands now, day and night, which is what the
 * tile's "im Ziel", the status line and its "seit 18:02" are all worked out
 * against. The Timeline draws a grow's phase against the targets the phase
 * recorded when it began, and a target changed since - a preset applied, a
 * value saved under Steuerung - left a tile saying "Tagesziel 62 % · im Ziel"
 * over a curve drawn under a band of 65-75. Where the place holds no targets
 * the panel is drawn as it came.
 */
export const judgedPanel = (panel: TimelinePanel | null, targets: OverviewTargets | null, startsAt: string, endsAt: string): TimelinePanel | null => {
  if (!panel || !targets) return panel;
  const half = (row: CardSetpoint[]): TimelineTarget | null => {
    const setpoint = setpointOf(row, panel.metric);
    return setpoint?.value == null || setpoint.band == null
      ? null
      : { setpoint: setpoint.value, band: { low: setpoint.value - setpoint.band, high: setpoint.value + setpoint.band } };
  };
  const day = half(targets.day);
  const night = half(targets.night);
  if (!day && !night) return panel;

  return { ...panel, targets: [{ startsAt, endsAt, phaseId: null, stage: null, day, night }] };
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
export type OutputWord = 'compressor' | 'heater' | 'dehumidifier' | 'co2';

const wordOf = (device: Device, output: OutputMetric): OutputWord | null => {
  if (output === 'dehumidifier') return device.type === 'fridge' ? 'compressor' : 'dehumidifier';
  return output === 'heater' || output === 'co2' ? output : null;
};

export interface OutputState {
  output: OutputMetric;
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

/** Since when the newest run of an output has gone on, where it is still going at the end of what was heard. */
export const runningSince = (lane: TimelineOutputLane | undefined): string | null => {
  const last = lane?.spans.at(-1);
  return last && lane && last.endsAt === lane.heardUntil ? last.startsAt : null;
};

const DAY_SECONDS = 24 * 60 * 60;

/** When the lamp comes on and goes off, on the account's wall clock, as hours past midnight for a bar and as "08:00" for a sentence. */
export interface LightWindow {
  /** Hours past local midnight, fractional. */
  start: number;
  hours: number;
  on: string;
  off: string;
  /** The lamp's own maximum, in per cent. */
  limit: number;
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

const clockOf = (seconds: number): string => {
  const there = ((Math.round(seconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  return `${twoDigits(Math.floor(there / 3600))}:${twoDigits(Math.floor((there % 3600) / 60))}`;
};

/**
 * The light's window today, read out of the climate device's document. The
 * document keeps seconds past midnight UTC and the account keeps a wall clock;
 * the server moves the seconds when the clocks change, so today's offset turns
 * one into the other.
 */
export const lightWindowOf = (device: Device | null, now: DateTime, zone: string | null): LightWindow | null => {
  if (!device?.configuration || !statesTargets(device.configuration)) return null;
  const draft = draftOf(device.configuration);
  const offset = offsetOf(now, zone);
  const local = (((draft.lightsOn + offset) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;

  return {
    start: local / 3600,
    hours: draft.lightHours,
    on: clockOf(draft.lightsOn + offset),
    off: clockOf(lightsOffOf(draft) + offset),
    limit: draft.lightLimit,
  };
};

/** "12" or "12,5": the length of the day the way a person says it. */
export const hoursFigure = (hours: number): number => Math.round(hours * 10) / 10;

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

/* ------------------------------------------------------------ the status */

/**
 * The one sentence a place opens with, worst first: gone quiet, being worked
 * on, an alarm, a reading off its target, readings arriving late, nothing to
 * judge against, or all in band.
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
}

const STEERED: Steered[] = ['temperature', 'humidity', 'co2'];

export const statusOf = (place: StatusInput, now: DateTime): Status => {
  const liveness: Liveness = livenessOf(place, now);
  if (liveness === 'none') return { kind: 'none' };
  if (liveness === 'offline') return place.values.length === 0 ? { kind: 'waiting' } : { kind: 'offline', since: measuredAtOf(place.values) };
  if (place.quiet) return { kind: 'maintenance', quiet: place.quiet };

  const alert = worstAlertOf({ openAlerts: place.openAlerts.filter(one => !isSilence(one)) });
  if (alert) return { kind: 'alert', alert };

  const off = STEERED.flatMap(metric => {
    const verdict = verdictOf(valueOf(place.values, metric), setpointOf(place.setpoints, metric), now);
    if (verdict?.kind !== 'high' && verdict?.kind !== 'low') return [];
    const band = setpointOf(place.setpoints, metric)?.band ?? 1;
    return [{ metric, high: verdict.kind === 'high', delta: verdict.delta, weight: verdict.delta / band }];
  }).sort((one, other) => other.weight - one.weight)[0];

  if (off) {
    const status = { kind: 'off' as const, metric: off.metric, high: off.high, delta: off.delta };
    if (!place.verdict) return status;
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
