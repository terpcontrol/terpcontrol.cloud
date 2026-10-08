import type { i18n as I18n } from 'i18next';
import { DateTime } from 'luxon';
import { co2FanOf, FAN_MODES, PLUG_SWITCHING, type TimerWindow } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { ALWAYS_LIT_FROM, lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { serverNow } from '@/api/clock';
import { PLUG_READING, RISING } from '@/screens/control/devices/own-summary';
import { scheduleTitle } from '@/screens/control/targets/schedule-words';
import { UNIT } from '@/ui/units';
import { offsetOf, wallClock } from '@/ui/wall-clock';

/**
 * The line the server writes when somebody changes a device's settings names
 * each figure that moved by its place in the firmware's document - one line
 * each, `workmode: small → off`, `lights.maintenanceOn: false → 1`. That is the
 * firmware's spelling, and a grower reading the Timeline learnt from it neither
 * that control was switched off nor that the light now stays on through a
 * maintenance window. So the figures the app lets anybody set are named here in
 * the words their controls carry, with their unit; a figure the app does not
 * know - a key a newer firmware adds - is shown as it came.
 *
 * A place is read alike whatever wrote it, but for the few that hold something
 * else on one type of device (`OWN_FIELDS`), where the line names its type. A
 * stand-alone LIGHT keeps its schedule, brightness and ramps at the top of its
 * document, where no other type keeps a figure, and an AIR fan's day and night
 * are sections holding the temperature and humidity a controller's do; a fan's
 * whole section, written where a LIGHT keeps a time, is no time and is shown as
 * it came. A stand-alone smart socket's figures are named as its own panel
 * names them, by the block they stand in and their row: "Tagsüber · Ein unter".
 */

type Kind = 'choice' | 'fanMode' | 'switch' | 'coupled' | 'slowedFan' | 'windows' | 'time' | 'number';

interface Field {
  kind: Kind;
  /** A symbol, or a unit of time written in the reader's words (`min`, `s`). */
  unit?: string;
  /** Where the words are another place's: a LIGHT's `limit` is the light limit a controller keeps in `lights.limit`. */
  as?: string;
  /**
   * Where the words are a panel's own: its catalogue keys, said as its blocks
   * nest them, and picked by the work mode the line names where that decides.
   */
  words?: readonly string[] | ((mode: string | null) => readonly string[]);
  /** Where the words of a choice's values are kept. */
  values?: string;
}

/** The row a socket's switch point stands in: on below and off above it for what it raises, the other way round for what it lowers. */
const edgeWords = (mode: string, edge: 'on' | 'off'): string => `plugSettings.edge.${RISING.includes(mode) ? 'rising' : 'falling'}.${edge}`;

/** A socket's switch points by day and at night, in the unit of the reading each mode switches by. */
const SWITCH_POINTS: Readonly<Record<string, Field>> = Object.fromEntries(
  PLUG_SWITCHING.flatMap(mode =>
    (['day', 'night'] as const).flatMap(when =>
      (['on', 'off'] as const).map(edge => [
        `${mode}.${when}.${edge}`,
        { kind: 'number', unit: UNIT[PLUG_READING[mode]], words: [`plugSettings.${when}`, edgeWords(mode, edge)] },
      ]),
    ),
  ),
);

/**
 * What a socket's `usedaynight` does depends on what it switches by: its own
 * switch points at night, or dosing CO2 by day only. A line that does not say
 * the mode names only the day and the night it tells apart.
 */
const dayNightWords = (mode: string | null): readonly string[] => [
  mode === 'co2'
    ? 'plugSettings.dayOnly'
    : (PLUG_SWITCHING as readonly string[]).includes(mode ?? '')
      ? 'plugSettings.dayNight'
      : 'plugSettings.dayLabel',
];

const FIELDS: Readonly<Record<string, Field>> = {
  workmode: { kind: 'choice', values: 'configChange.mode' },
  'day.temperature': { kind: 'number', unit: '°C' },
  'night.temperature': { kind: 'number', unit: '°C' },
  'day.humidity': { kind: 'number', unit: '%' },
  'night.humidity': { kind: 'number', unit: '%' },
  'co2.target': { kind: 'number', unit: 'ppm' },
  'co2.night': { kind: 'switch' },
  'lights.limit': { kind: 'number', unit: '%' },
  'lights.sunrise': { kind: 'number', unit: 'min' },
  'lights.sunset': { kind: 'number', unit: 'min' },
  'lights.maintenanceOn': { kind: 'switch' },
  'daynight.day': { kind: 'time' },
  'daynight.night': { kind: 'time' },
  'daynight.minimalDehumidifierOffTime': { kind: 'number', unit: 's' },
  'fans.external': { kind: 'number', unit: '%' },
  'fans.internal': { kind: 'number', unit: '%' },
  // Not figures of the device's document but what germination does about the
  // humidity, which the server writes into the same line when somebody changes it.
  'germination.warnTooHumid': { kind: 'switch' },
  'germination.humidifierHolds': { kind: 'switch' },
  // A LIGHT.
  day: { kind: 'time', as: 'daynight.day' },
  night: { kind: 'time', as: 'daynight.night' },
  limit: { kind: 'number', unit: '%', as: 'lights.limit' },
  sunrise: { kind: 'number', unit: 'min', as: 'lights.sunrise' },
  sunset: { kind: 'number', unit: 'min', as: 'lights.sunset' },
  max_temperature: { kind: 'number', unit: '°C' },
  // An AIR fan.
  mode: { kind: 'fanMode' },
  min_speed: { kind: 'number', unit: '%' },
  'day.fixed_speed': { kind: 'number', unit: '%' },
  'night.fixed_speed': { kind: 'number', unit: '%' },
  'day.max_speed': { kind: 'number', unit: '%' },
  'night.max_speed': { kind: 'number', unit: '%' },
  // The windows a smart socket doses CO2 in, which the server copies into the
  // fan it slows meanwhile; their times move with the clocks like any other.
  'co2inject.device_id': { kind: 'coupled' },
  'co2inject.speed': { kind: 'number', unit: '%' },
  'co2inject.usedaynight': { kind: 'switch' },
  'co2inject.day': { kind: 'time' },
  'co2inject.night': { kind: 'time' },
  'co2inject.period': { kind: 'number', unit: 'min' },
  'co2inject.duration': { kind: 'number', unit: 'min' },
  // The outputs handed to whoever publishes on the device's control topic: a fridge's, a socket's, a fan's, a LIGHT's.
  mqttcontrol: { kind: 'switch' },
  // A stand-alone smart socket's, which no other type keeps.
  usedaynight: { kind: 'switch', words: dayNightWords },
  ...SWITCH_POINTS,
  'co2.on': { kind: 'number', unit: UNIT.co2, words: ['plugSettings.points', edgeWords('co2', 'on')] },
  'co2.off': { kind: 'number', unit: UNIT.co2, words: ['plugSettings.points', edgeWords('co2', 'off')] },
  'co2.mode': { kind: 'choice', values: 'plugCo2', words: ['plugCo2.label'] },
  'co2.period': { kind: 'number', unit: 'min', words: ['plugCo2.label', 'plugCo2.every'] },
  'co2.duration': { kind: 'number', unit: 'min', words: ['plugCo2.label', 'plugCo2.for'] },
  fan: { kind: 'slowedFan', words: ['plugCo2.fan'] },
  'timer.timeframes': { kind: 'windows', words: ['plugSettings.windows.label'] },
  'limits.overtemperature.enabled': { kind: 'switch', words: ['plugProtections.overheat'] },
  'limits.overtemperature.limit': { kind: 'number', unit: '°C', words: ['plugProtections.overheat', 'plugProtections.overheatAt'] },
  'limits.overtemperature.hysteresis': { kind: 'number', unit: '°C', words: ['plugProtections.overheat', 'plugProtections.overheatBack'] },
  'limits.undertemperature.enabled': { kind: 'switch', words: ['plugProtections.cold'] },
  'limits.undertemperature.limit': { kind: 'number', unit: '°C', words: ['plugProtections.cold', 'plugProtections.coldAt'] },
  'limits.undertemperature.hysteresis': { kind: 'number', unit: '°C', words: ['plugProtections.cold', 'plugProtections.coldBack'] },
  'limits.time.enabled': { kind: 'switch', words: ['plugProtections.least'] },
  'limits.time.min_on': { kind: 'number', unit: 's', words: ['plugProtections.least', 'plugProtections.leastOn'] },
  'limits.time.min_off': { kind: 'number', unit: 's', words: ['plugProtections.least', 'plugProtections.leastOff'] },
};

/**
 * Places that hold something else on one type of device than on a controller,
 * in the words of that type's own panel. A stand-alone smart socket's work mode
 * is what it switches by, and it keeps a day and a night under `daynight` as a
 * controller does, but no lamp follows them: they are when its switch points by
 * night take over from those by day, so each is said alone and the two are no
 * light plan. A line from before the server wrote the type is read as it
 * always was.
 */
const OWN_FIELDS: Readonly<Record<string, Readonly<Record<string, Field>>>> = {
  plug: {
    workmode: { kind: 'choice', values: 'plugSettings.mode', words: ['plugSettings.mode.label'] },
    'daynight.day': { kind: 'time', words: ['plugSettings.dayFrom'] },
    'daynight.night': { kind: 'time', words: ['plugSettings.nightFrom'] },
  },
};

/** How a place is read on the type of device the line was written for, where that type has its own reading of it. */
const ownField = (type: string | null | undefined, place: string): Field | null => {
  const own = type && Object.hasOwn(OWN_FIELDS, type) ? OWN_FIELDS[type] : null;
  return own && Object.hasOwn(own, place) ? own[place] : null;
};

const fieldOf = (type: string | null | undefined, place: string): Field | null =>
  ownField(type, place) ?? (Object.hasOwn(FIELDS, place) ? FIELDS[place] : null);

/** The two times of a light schedule, where each type keeps them: a controller's and a fridge's, and a LIGHT's. */
const SCHEDULES = [
  ['daynight.day', 'daynight.night'],
  ['day', 'night'],
] as const;

const LINE = /^(.+?): (.*) → (.*)$/;

/**
 * What a line is read against: the account's zone and the instant it was
 * written, which together say on what wall clock its times of day were meant -
 * the server moves them when the clocks change, so a line from before the
 * change is read with the offset of then. `mode` is the work mode the device
 * was left in where it decides what a figure is - drying and germination hold
 * the night's figures round the clock, a socket's day is for what it switches
 * by - and `type` the type of the device, where the line says it.
 */
export interface ChangeContext {
  zone?: string | null;
  at?: string | null;
  mode?: string | null;
  type?: string | null;
}

/** How far the account's wall clock was ahead of UTC when the line was written. */
const offsetFor = (context: ChangeContext): number => offsetOf(context.at ? DateTime.fromISO(context.at) : serverNow(), context.zone ?? null);

/** A figure as the line wrote it, or null for none: a word, a section. */
const figureIn = (raw: string): number | null => {
  const figure = raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(figure) ? figure : null;
};

/** A unit after a figure: a unit of time in the reader's words ("Min"), any other as its symbol. */
const unitOf = (i18n: I18n, unit: string | undefined): string => (unit === 'min' || unit === 's' ? i18n.t(`units.${unit}`) : (unit ?? ''));

/**
 * A figure as the line wrote it, in the reader's words: `–` for one that was
 * not there, null for one that is not what the place holds.
 */
const valueOf = (i18n: I18n, field: Field, raw: string, context: ChangeContext): string | null => {
  // A fan is slowed for a socket's CO2 while its section names the socket, whichever socket it is.
  if (field.kind === 'coupled') return i18n.t(raw === '–' || raw === '' ? 'configChange.off' : 'configChange.on');
  if (raw === '–') return raw;
  switch (field.kind) {
    case 'choice': {
      const word = `${field.values}.${raw}`;
      return i18n.exists(word) ? i18n.t(word) : raw;
    }
    case 'fanMode': {
      // The firmware keeps the fan's mode as its place in the list.
      const mode = FAN_MODES.find((_, code) => code === figureIn(raw));
      return mode ? i18n.t(`configChange.fanMode.${mode}`) : raw;
    }
    case 'switch':
      return raw === 'true' || Number(raw) > 0 ? i18n.t('configChange.on') : i18n.t('configChange.off');
    case 'slowedFan': {
      // The socket names the fan it slows while dosing in a string of its own; which fan it is, is the fan's line to say.
      const fan = co2FanOf({ fan: raw });
      return fan ? `${fan.speed} %` : i18n.t('plugCo2.noFan');
    }
    case 'windows':
      return windowsOf(i18n, raw, context);
    case 'time': {
      // The document keeps seconds past midnight UTC; the reader thinks in the
      // clock on the wall of their account. A time past any time of day is a
      // light that never goes off, which is no time to name.
      const seconds = figureIn(raw);
      if (seconds === null) return null;
      return seconds >= ALWAYS_LIT_FROM ? i18n.t('targets.plan.alwaysShort') : wallClock(seconds, offsetFor(context));
    }
    case 'number': {
      const number = figureIn(raw);
      if (number === null) return null;
      return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, useGrouping: false }).format(number)} ${unitOf(i18n, field.unit)}`.trim();
    }
  }
};

const isWindow = (value: unknown): value is TimerWindow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TimerWindow).ontime === 'number' &&
  typeof (value as TimerWindow).duration === 'number';

/** A socket timer's windows on the account's clock - "10:00–10:30, 22:00–01:00" - or null for what is no list of them. */
const windowsOf = (i18n: I18n, raw: string, context: ChangeContext): string | null => {
  let windows: unknown;
  try {
    windows = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(windows) || !windows.every(isWindow)) return null;
  if (windows.length === 0) return i18n.t('plugSettings.summary.noWindows');

  const offset = offsetFor(context);
  return windows.map(window => `${wallClock(window.ontime, offset)}–${wallClock(window.ontime + window.duration * 60, offset)}`).join(', ');
};

/**
 * The figures held round the clock in a mode that knows no day, named by the
 * mode rather than as the night's. Germination's humidity is the one a
 * humidifier socket holds there, where the grower lets it.
 */
const HELD_IN: Readonly<Record<string, readonly string[]>> = {
  dry: ['night.temperature', 'night.humidity'],
  breed: ['night.temperature', 'night.humidity'],
};

/** What a place is called: in its panel's words where it has them, else by the mode it is held in or as the diary names it. */
const nameOf = (i18n: I18n, place: string, field: Field, context: ChangeContext): string => {
  const words = typeof field.words === 'function' ? field.words(context.mode ?? null) : field.words;
  if (words) return words.map(key => i18n.t(key)).join(' · ');
  return HELD_IN[context.mode ?? '']?.includes(place)
    ? i18n.t(`configChange.held.${context.mode}.${place}`)
    : i18n.t(`configChange.field.${field.as ?? place}`);
};

/** One line of the change, named and written out where the figure is one the app sets. */
const lineOf = (i18n: I18n, line: string, context: ChangeContext): string => {
  const match = LINE.exec(line);
  const field = match ? fieldOf(context.type, match[1]) : null;
  if (!match || !field) return line;

  const [before, after] = [valueOf(i18n, field, match[2], context), valueOf(i18n, field, match[3], context)];
  if (before === null || after === null) return line;

  return `${nameOf(i18n, match[1], field, context)}: ${before} → ${after}`;
};

/**
 * The light schedule, where both its times are in the change: one line, the
 * way the targets page says it - "Licht an 08:00–20:00 · 12 Std → Licht
 * durchgehend an · 24 Std". Its two times apart read 24 hours as a light that
 * goes off at the hour it comes on, and 0 hours as the same.
 */
const scheduleLineOf = (i18n: I18n, day: RegExpExecArray, night: RegExpExecArray, context: ChangeContext): string => {
  const offset = offsetFor(context);
  const said = (on: string, off: string): string => {
    const [lightsOn, lightsOff] = [figureIn(on), figureIn(off)];
    return lightsOn === null || lightsOff === null ? '–' : scheduleTitle(i18n.t.bind(i18n), lightWindowOf(lightsOn, lightsOff), offset);
  };
  return `${i18n.t('configChange.field.lightPlan')}: ${said(day[2], night[2])} → ${said(day[3], night[3])}`;
};

/** Both sides of a line read as times of day, or as none. */
const readsAsTimes = (match: RegExpExecArray): boolean => [match[2], match[3]].every(raw => raw === '–' || figureIn(raw) !== null);

/** The whole of what moved, a line each. */
export const configurationChange = (i18n: I18n, value: string, context: ChangeContext = {}): string => {
  const lines = value.split('\n');
  const matches = lines.map(line => LINE.exec(line));
  // The two times of a schedule are said as one line, where the first of them stood.
  const said = new Map<number, string | null>();
  for (const [on, off] of SCHEDULES) {
    if (ownField(context.type, on)) continue;
    const day = matches.findIndex(match => match?.[1] === on && readsAsTimes(match));
    const night = matches.findIndex(match => match?.[1] === off && readsAsTimes(match));
    const [dayMatch, nightMatch] = [matches[day], matches[night]];
    if (!dayMatch || !nightMatch) continue;
    said.set(Math.min(day, night), scheduleLineOf(i18n, dayMatch, nightMatch, context));
    said.set(Math.max(day, night), null);
  }

  return lines
    .flatMap((line, index) => {
      if (!said.has(index)) return [lineOf(i18n, line, context)];
      const schedule = said.get(index);
      return schedule ? [schedule] : [];
    })
    .join('\n');
};

/**
 * What one change of the work mode alone is called, which is what the row's
 * title then says instead of "Settings changed": "Control switched off",
 * "Drying started", and for a smart socket what it now switches by, as its
 * panel says it. Anything else moved with it keeps the general title.
 */
export const configurationTitle = (i18n: I18n, value: string, type: string | null = null): string | null => {
  const lines = value.split('\n');
  const match = lines.length === 1 ? LINE.exec(lines[0]) : null;
  if (!match || match[1] !== 'workmode') return null;

  const own = ownField(type, 'workmode');
  if (own) return `${nameOf(i18n, 'workmode', own, {})}: ${valueOf(i18n, own, match[3], {}) ?? match[3]}`;

  const [, , before, after] = match;
  const standard = (mode: string) => mode === 'small' || mode === 'full';
  const title =
    after === 'off'
      ? 'controlOff'
      : before === 'off'
        ? 'controlOn'
        : after === 'dry'
          ? 'dryingStarted'
          : before === 'dry'
            ? 'dryingEnded'
            : standard(before) && standard(after)
              ? after === 'full'
                ? 'energySavingOn'
                : 'energySavingOff'
              : null;

  if (title) return i18n.t(`configChange.title.${title}`);
  return i18n.exists(`configChange.mode.${after}`) ? i18n.t('configChange.title.mode', { mode: i18n.t(`configChange.mode.${after}`) }) : null;
};
