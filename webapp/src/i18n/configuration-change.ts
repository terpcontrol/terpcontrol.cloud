import type { i18n as I18n } from 'i18next';
import { DateTime } from 'luxon';
import { FAN_MODES } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { ALWAYS_LIT_FROM, lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { serverNow } from '@/api/clock';
import { scheduleTitle } from '@/screens/control/targets/schedule-words';
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
 * A line names no type of device, only the place of each figure, so a place is
 * read alike whatever wrote it. A stand-alone LIGHT keeps its schedule,
 * brightness and ramps at the top of its document, where no other type keeps a
 * figure, and an AIR fan's day and night are sections holding the temperature
 * and humidity a controller's do; a fan's whole section, written where a LIGHT
 * keeps a time, is no time and is shown as it came.
 */

type Kind = 'mode' | 'fanMode' | 'switch' | 'coupled' | 'time' | 'number';

interface Field {
  kind: Kind;
  /** A symbol, or a unit of time written in the reader's words (`min`, `s`). */
  unit?: string;
  /** Where the words are another place's: a LIGHT's `limit` is the light limit a controller keeps in `lights.limit`. */
  as?: string;
}

const FIELDS: Readonly<Record<string, Field>> = {
  workmode: { kind: 'mode' },
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
};

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
 * was left in where it holds the night's figures round the clock.
 */
export interface ChangeContext {
  zone?: string | null;
  at?: string | null;
  mode?: string | null;
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
    case 'mode':
      return i18n.exists(`configChange.mode.${raw}`) ? i18n.t(`configChange.mode.${raw}`) : raw;
    case 'fanMode': {
      // The firmware keeps the fan's mode as its place in the list.
      const mode = FAN_MODES.find((_, code) => code === figureIn(raw));
      return mode ? i18n.t(`configChange.fanMode.${mode}`) : raw;
    }
    case 'switch':
      return raw === 'true' || Number(raw) > 0 ? i18n.t('configChange.on') : i18n.t('configChange.off');
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

/**
 * The figures held round the clock in a mode that knows no day, named by the
 * mode rather than as the night's. Germination's humidity is the one a
 * humidifier socket holds there, where the grower lets it.
 */
const HELD_IN: Readonly<Record<string, readonly string[]>> = {
  dry: ['night.temperature', 'night.humidity'],
  breed: ['night.temperature', 'night.humidity'],
};

/** One line of the change, named and written out where the figure is one the app sets. */
const lineOf = (i18n: I18n, line: string, context: ChangeContext): string => {
  const match = LINE.exec(line);
  const field = match && Object.hasOwn(FIELDS, match[1]) ? FIELDS[match[1]] : undefined;
  if (!match || !field) return line;

  const [before, after] = [valueOf(i18n, field, match[2], context), valueOf(i18n, field, match[3], context)];
  if (before === null || after === null) return line;

  const name = HELD_IN[context.mode ?? '']?.includes(match[1])
    ? i18n.t(`configChange.held.${context.mode}.${match[1]}`)
    : i18n.t(`configChange.field.${field.as ?? match[1]}`);
  return `${name}: ${before} → ${after}`;
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
 * "Drying started". Anything else moved with it keeps the general title.
 */
export const configurationTitle = (i18n: I18n, value: string): string | null => {
  const lines = value.split('\n');
  const match = lines.length === 1 ? LINE.exec(lines[0]) : null;
  if (!match || match[1] !== 'workmode') return null;

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
