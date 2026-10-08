/**
 * Day and night as a fridge and a tent controller keep them, in the one place
 * the server, the screens and the simulator read it from.
 *
 * The firmware decides by the clock and by nothing else. Its document holds two
 * times of day as seconds past midnight UTC - `daynight.day`, when the light
 * comes on, and `daynight.night`, when it goes off - and about once a second it
 * compares the UTC time of day with them, strictly: between the two it is day,
 * otherwise night, a window that runs past midnight wrapping round it, and two
 * equal times never being day at all. In the day the lamp ramps up to its limit
 * and down again inside the window, the day's figures hold and CO2 is dosed; at
 * night the night's figures hold. Whether the lamp really shines meanwhile - a
 * limit of 0 %, a lamp held off from the cloud, a lamp the heat dimmed, 15 % in
 * maintenance - changes nothing about which figures hold.
 *
 * The work mode decides whether there is a day at all. The standard modes and
 * the greenhouse mode run the schedule; drying and germination hold the night's
 * figures round the clock in the dark; switched off, nothing is held.
 *
 * A fridge glides its targets between the two halves while the lamp ramps
 * (`daynight.linearChange`, which the server always writes); a controller
 * switches them with the clock.
 *
 * No schema, and nothing imported but the schema-free reading of a document,
 * so a client and the simulator can share the arithmetic without pulling zod
 * and the whole contract in.
 */

import { finiteOrNull, valueAt } from './configuration-fields.js';

export const DAY_SECONDS = 24 * 60 * 60;

/** Seconds round the clock: 25:00 is 01:00, and an hour before 00:30 is 23:30. */
export const roundTheClock = (seconds: number): number => ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;

/**
 * The window every firmware - a fridge's, a controller's, a socket's, a fan's
 * and a lamp's - runs where its document states none: on at 06:00, off at
 * 22:00 UTC.
 */
export const FIRMWARE_LIGHTS_ON = 6 * 60 * 60;
export const FIRMWARE_LIGHTS_OFF = 22 * 60 * 60;

/** Minutes of each dimming ramp where a fridge's or a controller's document states none. */
export const FIRMWARE_RAMP_MINUTES = 15;

/**
 * How long after a switch between day and night the climate is given to follow
 * the new half's targets before it is judged against them alone.
 *
 * A fridge needs about forty minutes to come down from a day of 25 °C to a
 * night of 21 °C, and a tent warms up after the lamp comes on. Judged against
 * the new half from the second it begins, every evening read "too warm since
 * 20:02" and every morning "too cold since 08:02", which is the device doing
 * exactly what it was told. Meanwhile a reading anywhere between the two halves'
 * bands is on target; one outside both is not.
 */
export const SETTLE_SECONDS = 60 * 60;

/**
 * Where 24 hours of light are written: both times past any time of day, the
 * night one second before the day.
 *
 * The firmware cannot be told "always" in so many words. Two equal times are
 * always night, and a window one second short of a day - what was written for
 * 24 hours before - left two seconds of night a day, with the evening ramp
 * dimming the lamp to nothing before them and the morning ramp bringing it back
 * after: a dip of half an hour every day, the fridge gliding its targets towards
 * the night meanwhile and its CO2 stopping. With the day starting after the
 * night and the night beyond any second of the clock, its own comparisons find
 * every second to be day, the evening ramp never begins (the night is further
 * away than any ramp is long) and the morning ramp's factor overflows to full.
 * The hour the light came on is kept in the times, so going back to a
 * photoperiod starts from it.
 */
export const ALWAYS_LIT_FROM = 2 * DAY_SECONDS;

const wrap = (seconds: number): number => roundTheClock(Math.round(seconds));

/** The light schedule as a person sets it. */
export interface LightWindow {
  /** When the light comes on, in seconds past midnight UTC. */
  lightsOn: number;
  /** How long it stays on, in hours, to the minute: 0 is always night, 24 always day. */
  lightHours: number;
}

/** How many whole seconds of a day the firmware's comparisons call day. */
const daySecondsOf = (day: number, night: number): number => {
  if (day === night) return 0;
  if (day < night) return Math.max(0, Math.min(night - 1, DAY_SECONDS - 1) - day);
  return Math.max(0, DAY_SECONDS - 1 - day) + Math.min(night, DAY_SECONDS);
};

/**
 * The window two times of a document make, read the way the firmware reads
 * them: whatever they are, the hours are the ones it runs as day. A light that
 * goes off at the second it comes on is no light at all, and one a second or
 * two short of a day - as 24 hours used to be written - is a whole day.
 * Missing times are the firmware's own.
 */
export const lightWindowOf = (day: number | null | undefined, night: number | null | undefined): LightWindow => {
  const on = day ?? FIRMWARE_LIGHTS_ON;
  const off = night ?? FIRMWARE_LIGHTS_OFF;
  const lit = daySecondsOf(on, off);
  const hours = lit >= DAY_SECONDS - 2 ? 24 : Math.round(lit / 60) / 60;

  // Past midnight a day that starts after any second of the clock starts at
  // midnight; and a whole day written as `ALWAYS_LIT_FROM` keeps its hour in the
  // night's time.
  const lightsOn = on > off && off >= DAY_SECONDS ? wrap(off) : on > off && on >= DAY_SECONDS - 1 ? 0 : wrap(on);
  return { lightsOn, lightHours: hours };
};

/**
 * The two times to write for a window: the one place they are worked out, for
 * the targets page, a preset, a plan step and the clocks changing alike.
 *
 * - 24 hours is a day that never ends (see `ALWAYS_LIT_FROM`).
 * - 0 hours is the light coming on and going off at the same second, which the
 *   firmware reads as always night.
 * - A light that goes off at midnight UTC on the dot goes off a second before
 *   it. The firmware works its evening ramp out without going round the clock,
 *   so at 0 it found the ramp running all day, clamped it to full and dropped it:
 *   the lamp went out hard, a fridge stopped gliding into the night, and the CO2
 *   it should stop during the ramp ran on to the last second.
 */
export const lightWindowTimes = (window: LightWindow): { day: number; night: number } => {
  const on = wrap(window.lightsOn);
  const lit = Math.round(window.lightHours * 3600);
  if (lit <= 0) return { day: on, night: on };
  if (lit >= DAY_SECONDS) return { day: ALWAYS_LIT_FROM + on + 1, night: ALWAYS_LIT_FROM + on };

  const off = wrap(on + lit);
  return { day: on, night: off === 0 ? DAY_SECONDS - 1 : off };
};

/**
 * When the light goes off, in seconds past midnight UTC, for saying it and for
 * drawing it: the hour it comes on again for a light that never goes off, or
 * never comes on. The times a document is written with are another matter - a
 * whole day, no day and a light off at midnight UTC each have their own form
 * there (`lightWindowTimes`).
 */
export const lightsOffOf = (window: LightWindow): number => wrap(window.lightsOn + Math.round(window.lightHours * 3600));

/* ---------------------------------------------------------------- the cycle */

/** What the firmware decides a fridge's or a controller's day and night from, as its document states it. */
export interface Cycle {
  /** The two times as the document holds them (see `lightWindowOf`). */
  day: number;
  night: number;
  /** The work mode; null where the document states none, which is read as the standard mode. */
  workmode: string | null;
  /** Minutes of the dimming ramps inside the day. */
  sunrise: number;
  sunset: number;
  /** Whether the targets glide between the halves while the lamp ramps: a fridge with `daynight.linearChange`. */
  glides: boolean;
}

/**
 * The modes that run a day and a night by the clock. The firmware treats any
 * word it does not know as off, and the fridge's experimental mode runs the
 * clock with every output off.
 */
export const SCHEDULED_MODES: readonly string[] = ['small', 'full', 'temp'];

/** The hardware whose firmware keeps this cycle. An AIR fan's day is what its light sensor sees; a socket and a lamp hold no targets. */
const WITH_CYCLE: readonly string[] = ['fridge', 'controller'];

/** A figure of a document (`valueAt`); a flag is 1 or 0, as the firmware reads it. */
const numberAt = (document: Record<string, unknown>, path: string): number | null => {
  const value = valueAt(document, path);
  return typeof value === 'boolean' ? Number(value) : finiteOrNull(value);
};

/** The cycle a document runs, or null for hardware that keeps none and for no document at all. */
export const cycleOf = (type: string, configuration: Record<string, unknown> | null | undefined): Cycle | null => {
  if (!configuration || !WITH_CYCLE.includes(type)) return null;

  const workmode = configuration.workmode;
  return {
    day: numberAt(configuration, 'daynight.day') ?? FIRMWARE_LIGHTS_ON,
    night: numberAt(configuration, 'daynight.night') ?? FIRMWARE_LIGHTS_OFF,
    workmode: typeof workmode === 'string' ? workmode : null,
    sunrise: numberAt(configuration, 'lights.sunrise') ?? FIRMWARE_RAMP_MINUTES,
    sunset: numberAt(configuration, 'lights.sunset') ?? FIRMWARE_RAMP_MINUTES,
    // A controller's firmware reads no such key and switches with the clock.
    glides: type === 'fridge' && (numberAt(configuration, 'daynight.linearChange') ?? 0) > 0,
  };
};

/**
 * What a cycle amounts to.
 *
 * - `schedule`: a day and a night by the clock.
 * - `always_day`, `always_night`: 24 and 0 hours of light - one half held round the clock.
 * - `drying`, `germination`: the night's figures held round the clock in the dark.
 * - `off`: nothing held at all.
 */
export type CycleKind = 'schedule' | 'always_day' | 'always_night' | 'drying' | 'germination' | 'off';

export const cycleKindOf = (cycle: Cycle): CycleKind => {
  if (cycle.workmode === 'dry') return 'drying';
  if (cycle.workmode === 'breed') return 'germination';
  if (cycle.workmode !== null && !SCHEDULED_MODES.includes(cycle.workmode)) return 'off';

  const lit = daySecondsOf(cycle.day, cycle.night);
  return lit === 0 ? 'always_night' : lit >= DAY_SECONDS ? 'always_day' : 'schedule';
};

/** The UTC time of day of an instant, in whole seconds: the firmware's own clock. */
export const utcSecondsOf = (at: number): number => wrap(Math.floor(at / 1000));

/** Whether the firmware calls this second of the clock day, by its own strict comparisons. Only the times; the work mode is the caller's. */
export const isDayAt = (cycle: Pick<Cycle, 'day' | 'night'>, seconds: number): boolean =>
  cycle.day > cycle.night ? seconds > cycle.day || seconds < cycle.night : cycle.day < cycle.night ? seconds > cycle.day && seconds < cycle.night : false;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * How far the morning and the evening ramp have come at this second of the
 * day: 1 is the lamp at full and a fridge on its day's figures. Worked out as
 * the firmware works it out - unsigned, without going round the clock - so a
 * ramp that crosses midnight UTC is cut short here exactly as it is on the
 * device.
 */
export const rampsAt = (cycle: Cycle, seconds: number): { sunrise: number; sunset: number } => {
  const up = cycle.sunrise * 60;
  const down = cycle.sunset * 60;
  const rising = cycle.sunrise > 0 && seconds + DAY_SECONDS < ((cycle.day + DAY_SECONDS) >>> 0) + up;
  const setting = cycle.sunset > 0 && seconds + DAY_SECONDS > ((cycle.night + DAY_SECONDS) >>> 0) - down;

  return {
    sunrise: rising ? clamp01(((seconds - cycle.day) >>> 0) / up) : 1,
    sunset: setting ? clamp01(((cycle.night - seconds) >>> 0) / down) : 1,
  };
};

/** A target a fridge is gliding to: `factor` of the way from the night's figure to the day's. */
export const glidingTarget = (day: number, night: number, factor: number): number => night + (day - night) * factor;

/** A change from one half's targets to the other's, and the time the climate is given to follow it. */
export interface Transition {
  from: 'day' | 'night';
  to: 'day' | 'night';
  /** Epoch milliseconds: when it began - the start of a fridge's ramp, or the switch - and when the climate is judged against `to` alone again. */
  startsAt: number;
  until: number;
  /** While a fridge's targets glide, how far they have come from the night's figures (0) to the day's (1); null once they have arrived. */
  glide: number | null;
}

/** Where a device stands in its cycle at an instant. */
export interface CycleMoment {
  kind: CycleKind;
  /** Which half's figures hold: the night's in drying and germination, and for a light that never comes on. */
  active: 'day' | 'night';
  /** `constant` where nothing alternates. */
  period: 'day' | 'night' | 'constant';
  /** Epoch milliseconds: when the half began and when it ends; null where nothing alternates. */
  since: number | null;
  until: number | null;
  transition: Transition | null;
}

/** The two instants the schedule switches at, as seconds of the day, and how long the light is on between them. */
const switchesOf = (cycle: Cycle): { on: number; off: number; lit: number } => {
  const window = lightWindowOf(cycle.day, cycle.night);
  return { on: window.lightsOn, off: lightsOffOf(window), lit: Math.round(window.lightHours * 3600) };
};

/** The latest instant at or before `at` whose UTC time of day is `seconds`. */
const lastAt = (at: number, seconds: number): number => at - wrap(utcSecondsOf(at) - seconds) * 1000 - (at % 1000);

/** The first instant after `at` whose UTC time of day is `seconds`. */
const nextAt = (at: number, seconds: number): number => {
  const last = lastAt(at, seconds);
  return last + DAY_SECONDS * 1000;
};

/**
 * The transitions a schedule makes in a day, as the instants each one starts
 * at nearest before `at`: the morning one from the switch to day until the
 * climate has had `SETTLE_SECONDS` after a fridge's ramp; the evening one from
 * the start of a fridge's ramp (the switch, on a controller) until the same
 * time after the switch to night.
 */
const transitionsBefore = (cycle: Cycle, at: number): Transition[] => {
  const { on, off } = switchesOf(cycle);
  const up = cycle.glides ? cycle.sunrise * 60 : 0;
  const down = cycle.glides ? cycle.sunset * 60 : 0;

  const morning = lastAt(at, on);
  const evening = lastAt(at, wrap(off - down));
  return [
    { from: 'night', to: 'day', startsAt: morning, until: morning + (up + SETTLE_SECONDS) * 1000, glide: null },
    { from: 'day', to: 'night', startsAt: evening, until: evening + (down + SETTLE_SECONDS) * 1000, glide: null },
  ];
};

/** Where a cycle stands at an instant (epoch milliseconds). */
export const cycleAt = (cycle: Cycle, at: number): CycleMoment => {
  const kind = cycleKindOf(cycle);
  if (kind !== 'schedule') {
    return { kind, active: kind === 'always_day' ? 'day' : 'night', period: 'constant', since: null, until: null, transition: null };
  }

  const seconds = utcSecondsOf(at);
  const day = isDayAt(cycle, seconds);
  const { on, off } = switchesOf(cycle);
  const ramps = rampsAt(cycle, seconds);
  // The firmware works the ramps out in the day only, the rising one first.
  const glide = cycle.glides && day ? (ramps.sunrise < 1 ? ramps.sunrise : ramps.sunset < 1 ? ramps.sunset : null) : null;
  const running = transitionsBefore(cycle, at)
    .filter(one => at < one.until)
    .sort((one, other) => other.startsAt - one.startsAt)[0];

  return {
    kind,
    active: day ? 'day' : 'night',
    period: day ? 'day' : 'night',
    since: lastAt(at, day ? on : off),
    until: nextAt(at, day ? off : on),
    transition: running ? { ...running, glide } : null,
  };
};

/** A stretch of time, in epoch milliseconds. */
export interface Span {
  from: number;
  to: number;
}

const merged = (spans: Span[]): Span[] =>
  spans
    .filter(span => span.to > span.from)
    .sort((one, other) => one.from - other.from)
    .reduce<Span[]>((kept, span) => {
      const last = kept.at(-1);
      if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
      else kept.push({ ...span });
      return kept;
    }, []);

/** Each day's occurrence of a stretch of the clock from `start` lasting `seconds`, over a range, clipped to it. */
const daily = (range: Span, start: number, seconds: number): Span[] => {
  if (seconds <= 0) return [];
  const first = lastAt(range.from, start) - DAY_SECONDS * 1000;
  const spans: Span[] = [];
  for (let from = first; from < range.to; from += DAY_SECONDS * 1000) {
    spans.push({ from: Math.max(from, range.from), to: Math.min(from + seconds * 1000, range.to) });
  }
  return merged(spans);
};

/**
 * The nights of a schedule over a range: the stretches between the light going
 * off and coming on again, which a chart shades and a diary averages apart.
 *
 * Only a schedule has any. Drying, germination and a light that is on or off
 * round the clock hold one climate the whole time - there is no night to tell
 * from a day - and answering them as one long night shaded a whole drying week
 * grey under "the night" and named its band the night's.
 */
export const nightsIn = (cycle: Cycle, range: Span): Span[] => {
  if (range.to <= range.from || cycleKindOf(cycle) !== 'schedule') return [];

  const { off, lit } = switchesOf(cycle);
  return daily(range, off, DAY_SECONDS - lit);
};

/** When a schedule is changing between its halves over a range (see `SETTLE_SECONDS`); none for anything else. */
export const transitionsIn = (cycle: Cycle, range: Span): Span[] => {
  if (range.to <= range.from || cycleKindOf(cycle) !== 'schedule') return [];

  const { on, off } = switchesOf(cycle);
  const up = cycle.glides ? cycle.sunrise * 60 : 0;
  const down = cycle.glides ? cycle.sunset * 60 : 0;
  return merged([...daily(range, on, up + SETTLE_SECONDS), ...daily(range, wrap(off - down), down + SETTLE_SECONDS)]);
};
