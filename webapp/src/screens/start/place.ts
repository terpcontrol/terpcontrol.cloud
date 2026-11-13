import type { DateTime } from 'luxon';
import type {
  Alert,
  CardSetpoint,
  CardValue,
  ClimateVerdict,
  Device,
  DeviceLive,
  Entry,
  Metric,
  OpenAlert,
  OverviewCamera,
  OverviewTargets,
  TimelinePanel,
  TimelineTarget,
} from '@fg2/shared-types/v1';
import { germinationChoicesOf } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { switchPointName, type PlugSwitching } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { roundTheClock, utcSecondsOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { STEERED, TARGET_BAND, type Steered } from '@fg2/shared-types/v1-schemas/steering.js';
import { ruleTitle } from '@/i18n/alarm-line';
import type { Translate } from '@/i18n/i18n';
import { fieldValue } from '@/ui/advanced/field-values';
import { deviceLiveness, offlineLabel, silentSince, sinceLabel, valueAge } from '@/ui/age';
import { darkReasonOf, figureOf, statesTargets } from '@/ui/climate-hardware';
import type { Quiet } from '@/ui/maintenance';
import { deviceName } from '@/ui/naming';
import { alertLabel, asWritten, figureWithUnit, isSilence } from '@/ui/units';
import { offsetOf, wallClock } from '@/ui/wall-clock';
import { clock } from '@/ui/zone';
import { plugModeOf, plugReadingOf } from '@/screens/control/devices/own-summary';
import { nowHoldingOf, setpointsOf, storedShapeOf, type Half } from '@/screens/control/targets/day-night';
import { windowWords } from '@/screens/control/targets/schedule-words';
import { draftOf } from '@/screens/control/targets/targets-draft';
import { worstFirst } from '@/screens/alerts/inbox';
import { livenessOf, measuredAtOf, type Liveness } from './attention';

/**
 * What Start decides about a place before it draws anything: which device
 * holds the climate, what a reading's verdict is, when the lamp is on and what
 * one sentence says how the place is. All of it is arithmetic over answers the
 * screen already holds, so a place's Start, its card among several and the
 * header's choice of place say the same thing about the same tent.
 */

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

/** A verdict in the words `VerdictWords` draws, for a reading said as one sentence. */
export const verdictSaid = (t: Translate, verdict: Verdict, metric: Metric, now: DateTime, zone: string | null): string | null => {
  if (!verdict) return null;
  if (verdict.kind === 'in') return t('home.card.inBand');
  if (verdict.kind === 'settling') return t('start.tile.settling', { time: clock(verdict.until, zone) });
  if (verdict.kind === 'last') return [t('offline.lastValue'), verdict.at ? sinceLabel(verdict.at, now, zone) : null].filter(Boolean).join(' ');
  return t(`start.tile.${verdict.kind}`, { delta: figureWithUnit(verdict.delta, metric) });
};

const verdictOf = (value: CardValue | null, setpoint: CardSetpoint | null, now: DateTime): Verdict => {
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
 * humidity target, so without this the page said "Alles im Ziel" over a box
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
 * A day of one reading with the band Start judges it by. The Timeline's bands
 * are what the controller aimed at, change by change - the server's record -
 * so a panel that carries them is drawn as it came. Only a panel with no band
 * at all borrows the targets as they stand now, day and night.
 */
export const judgedPanel = (panel: TimelinePanel | null, targets: OverviewTargets | null, startsAt: string, endsAt: string): TimelinePanel | null => {
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

  return { ...panel, targets: [{ startsAt, endsAt, phaseId: null, stage: null, day, night }] };
};

/** Between the two points a socket switches at, which is the range it holds its reading in. */
interface SwitchRange {
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
  if (!device || !mode || plugReadingOf(mode) !== metric) return null;

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

/** When the lamp comes on and goes off, on the account's wall clock, as hours past midnight for a bar and as "08:00" for a sentence. */
interface LightWindow {
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
export const lightWindowOf = (device: Device | null, now: DateTime, zone: string | null): LightWindow | null => {
  if (device?.type === 'light') return lampWindowOf(device, now, zone);
  if (darkReasonOf(device)) return null;
  // A fan's day is what its light sensor sees; it keeps no light window of its own.
  if (!device?.configuration || !statesTargets(device.configuration) || device.type === 'fan') return null;
  const draft = draftOf(device.configuration);
  const offset = offsetOf(now, zone);
  const { on, off, always, never } = windowWords(draft, offset);

  return { start: roundTheClock(draft.lightsOn + offset) / 3600, hours: draft.lightHours, on, off, limit: draft.lightLimit, always, never };
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
export const halfNowOf = (device: Device | null, live: DeviceLive | undefined, now: DateTime, offline: boolean): Half | null => {
  const shape = storedShapeOf(device);
  if (!device?.configuration || !shape) return offline ? null : (setpointsOf(live)?.active ?? null);

  return nowHoldingOf({ device, shape, stored: draftOf(device.configuration), live, offline, now, clock: () => '' }).half;
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
 * page that says "since 18:02" about the same tent.
 */
export type Status =
  /** `more` on a status that outranks the alert sentence: how many alerts of the place stand open behind it, unnamed. */
  | { kind: 'offline'; since: string | null; more: number }
  | { kind: 'none' }
  | { kind: 'waiting'; more: number }
  | { kind: 'maintenance'; quiet: Quiet; more: number }
  | { kind: 'controlOff'; more: number }
  /** The alert Meldungen leads with for this place, and how many more of the place's are open behind it. */
  | { kind: 'alert'; alert: PlaceAlert; more: number }
  /** `since` is null for a run too short to count yet, and undefined where no verdict was at hand to say. */
  | { kind: 'off'; metric: Steered; high: boolean; delta: number; since?: string | null }
  | { kind: 'stale'; at: string | null }
  | { kind: 'noTargets' }
  | { kind: 'good' };

/** A place's open alert as its card lists it, about a device where the account's own list of alerts names one. */
export type PlaceAlert = OpenAlert & { deviceId?: string | null; device?: Device };

/**
 * A place's open alerts for its status: each with the device the account's
 * list of alerts (`open`, what Meldungen draws) says it is about. A silence
 * is kept only as that of a device known to stand here and still silent: the
 * place's own silence is the pill's and the box's to say, a device heard
 * again waits for its alert to close, and a reader without that list - the
 * demo - is told of no device.
 */
export const placeAlerts = (listed: OpenAlert[], open: readonly Alert[] | undefined, here: Device[], now: DateTime): PlaceAlert[] =>
  listed.flatMap((alert): PlaceAlert[] => {
    const deviceId = open?.find(one => one.id === alert.alertId)?.deviceId ?? null;
    if (!isSilence(alert)) return [{ ...alert, deviceId }];
    const device = here.find(one => one.id === deviceId);
    return device && deviceLiveness(device.state.lastSeenAt, now) === 'offline' ? [{ ...alert, deviceId, device }] : [];
  });

interface StatusInput {
  values: CardValue[];
  setpoints: CardSetpoint[];
  deviceIds: string[] | null;
  /** As `placeAlerts` hands them over; a bare list names no silence. */
  openAlerts: PlaceAlert[];
  /** The device the place is judged by: its silence is the place's own, which the pill and the box say. */
  leadId?: string | null;
  /** The day's verdict, which a place's own Start reads and its card among several is not sent. */
  verdict?: ClimateVerdict | null;
  quiet: Quiet | null;
  /** A device here has its whole control switched off, which every reading after it is explained by. */
  controlOff?: boolean;
  /** The humidity a humidifier holds while the device germinates, which the server names no target for. */
  humidifierHold?: HumidifierHold | null;
  /** Since when a device here has been silent, where it has been for so long that no value of it is left to date it by. */
  silentSince?: string | null;
}

export const statusOf = (place: StatusInput, now: DateTime): Status => {
  const liveness: Liveness = livenessOf(place, now);
  // The first in Meldungen's order (`worstFirst`), so Start names what the inbox leads with.
  const open = worstFirst(place.openAlerts.filter(one => !isSilence(one) || (one.device !== undefined && one.deviceId !== place.leadId)));
  const alerted: Status | null = open.length > 0 ? { kind: 'alert', alert: open[0], more: open.length - 1 } : null;
  const more = open.length;
  // A place with no sensor can still have something open: a camera that stopped delivering is its one way to go wrong.
  if (liveness === 'none') return alerted ?? { kind: 'none' };
  if (liveness === 'offline') {
    if (place.values.length > 0) return { kind: 'offline', since: measuredAtOf(place.values), more };
    // No value at all: a device that has yet to send its first one, unless it is known to have been heard and gone quiet.
    return place.silentSince ? { kind: 'offline', since: place.silentSince, more } : { kind: 'waiting', more };
  }
  if (place.quiet) return { kind: 'maintenance', quiet: place.quiet, more };
  if (place.controlOff) return { kind: 'controlOff', more };

  if (alerted) return alerted;

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

/** The status in words, the same on a place's Start and on its card. */
export const statusText = (t: Translate, status: Status, now: DateTime, zone: string | null): string => {
  // Behind whatever is said: how many open alerts of the place it leaves unnamed.
  const more = 'more' in status && status.more > 0 ? ` · ${t('start.status.more', { count: status.more })}` : '';
  switch (status.kind) {
    case 'offline':
      return offlineLabel(status.since, now, zone, true) + more;
    case 'none':
      return t('home.invite.noSensor');
    case 'off': {
      const words = t(`start.status.${status.high ? 'high' : 'low'}${status.since === null ? 'Now' : ''}`, {
        metric: t(`home.metric.${status.metric}`),
        delta: figureWithUnit(status.delta, status.metric),
      });
      return status.since ? `${words} · ${t('start.status.since', { time: sinceLabel(status.since, now, zone) })}` : words;
    }
    case 'alert': {
      // The rule by the name every page calls it, which is not the English one the server stores.
      const alert = { ...status.alert, name: status.alert.name && ruleTitle(t, { name: status.alert.name }) };
      // A device of the place gone silent beside one that reports is named, as Meldungen names it.
      const what = alert.device ? t('alerts.title.offline', { what: deviceName(alert.device, t) }) : alertLabel(t, alert, now, zone);
      const since = t('start.status.since', { time: sinceLabel(alert.device ? silentSince(alert) : alert.startedAt, now, zone) });
      return `${what} · ${since}${more}`;
    }
    case 'maintenance':
      return (
        (status.quiet.parked
          ? t('start.status.maintenance', { until: clock(status.quiet.until, zone) })
          : t('start.status.settling', { until: clock(status.quiet.alarmsUntil, zone) })) + more
      );
    case 'stale':
      return t('start.status.stale', { time: status.at ? sinceLabel(status.at, now, zone) : '' });
    default:
      return t(`start.status.${status.kind}`) + more;
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

/** The newest photo somebody wrote into the diary, which a grow without a camera is shown by. */
export const ownPhotoOf = (entries: Entry[], growId: string): Entry | null =>
  entries.find(entry => entry.growId === growId && entry.cameraId === null && entry.mediaIds.length > 0) ?? null;
