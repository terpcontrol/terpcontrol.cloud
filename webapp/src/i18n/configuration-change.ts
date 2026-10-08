import type { i18n as I18n } from 'i18next';
import { DateTime } from 'luxon';
import { ALWAYS_LIT_FROM, lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { serverNow } from '@/api/clock';
import { scheduleTitle } from '@/screens/control/targets/schedule-words';
import { offsetOf, wallClock } from '@/screens/control/targets/targets-draft';

/**
 * The line the server writes when somebody changes a device's settings names
 * each figure that moved by its place in the firmware's document - one line
 * each, `workmode: small → off`, `lights.maintenanceOn: false → 1`. That is the
 * firmware's spelling, and a grower reading the Timeline learnt from it neither
 * that control was switched off nor that the light now stays on through a
 * maintenance window. So the figures the app lets anybody set are named here in
 * the words their controls carry, with their unit; a figure the app does not
 * know - a key a newer firmware adds - is shown as it came.
 */

type Kind = 'mode' | 'switch' | 'time' | 'number';

interface Field {
  kind: Kind;
  unit?: string;
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
};

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

/** A figure as the line wrote it, in the reader's words: `–` for one that was not there. */
const valueOf = (i18n: I18n, field: Field, raw: string, context: ChangeContext): string => {
  if (raw === '–') return raw;
  switch (field.kind) {
    case 'mode':
      return i18n.exists(`configChange.mode.${raw}`) ? i18n.t(`configChange.mode.${raw}`) : raw;
    case 'switch':
      return raw === 'true' || Number(raw) > 0 ? i18n.t('configChange.on') : i18n.t('configChange.off');
    case 'time': {
      // The document keeps seconds past midnight UTC; the reader thinks in the
      // clock on the wall of their account. A time past any time of day is a
      // light that never goes off, which is no time to name.
      const seconds = Number(raw);
      if (!Number.isFinite(seconds)) return raw;
      return seconds >= ALWAYS_LIT_FROM ? i18n.t('targets.plan.alwaysShort') : wallClock(seconds, offsetFor(context));
    }
    case 'number': {
      const number = Number(raw);
      if (!Number.isFinite(number)) return raw;
      return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(number)} ${field.unit ?? ''}`.trim();
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
  const field = match ? FIELDS[match[1]] : undefined;
  if (!match || !field) return line;

  const name = HELD_IN[context.mode ?? '']?.includes(match[1])
    ? i18n.t(`configChange.held.${context.mode}.${match[1]}`)
    : i18n.t(`configChange.field.${match[1]}`);
  return `${name}: ${valueOf(i18n, field, match[2], context)} → ${valueOf(i18n, field, match[3], context)}`;
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
    const [lightsOn, lightsOff] = [Number(on), Number(off)];
    if (on === '–' || off === '–' || !Number.isFinite(lightsOn) || !Number.isFinite(lightsOff)) return '–';
    return scheduleTitle(i18n.t.bind(i18n), lightWindowOf(lightsOn, lightsOff), offset);
  };
  return `${i18n.t('configChange.field.lightPlan')}: ${said(day[2], night[2])} → ${said(day[3], night[3])}`;
};

/** The whole of what moved, a line each. */
export const configurationChange = (i18n: I18n, value: string, context: ChangeContext = {}): string => {
  const lines = value.split('\n');
  const day = lines.map(line => LINE.exec(line)).find(match => match?.[1] === 'daynight.day') ?? null;
  const night = lines.map(line => LINE.exec(line)).find(match => match?.[1] === 'daynight.night') ?? null;
  const schedule = day && night ? scheduleLineOf(i18n, day, night, context) : null;

  return lines
    .flatMap(line => {
      if (!schedule || !/^daynight\.(day|night): /.test(line)) return [lineOf(i18n, line, context)];
      // The two times are said as one line, where the first of them stood.
      return line.startsWith('daynight.day: ') ? [schedule] : [];
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
