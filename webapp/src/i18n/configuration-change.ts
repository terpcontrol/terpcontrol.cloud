import type { i18n as I18n } from 'i18next';
import { serverNow } from '@/api/clock';
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
  'lights.limit': { kind: 'number', unit: '%' },
  'lights.sunrise': { kind: 'number', unit: 'min' },
  'lights.sunset': { kind: 'number', unit: 'min' },
  'lights.maintenanceOn': { kind: 'switch' },
  'daynight.day': { kind: 'time' },
  'daynight.night': { kind: 'time' },
  'daynight.minimalDehumidifierOffTime': { kind: 'number', unit: 's' },
  'fans.external': { kind: 'number', unit: '%' },
  'fans.internal': { kind: 'number', unit: '%' },
};

const LINE = /^(.+?): (.*) → (.*)$/;

/** A figure as the line wrote it, in the reader's words: `–` for one that was not there. */
const valueOf = (i18n: I18n, field: Field, raw: string): string => {
  if (raw === '–') return raw;
  switch (field.kind) {
    case 'mode':
      return i18n.exists(`configChange.mode.${raw}`) ? i18n.t(`configChange.mode.${raw}`) : raw;
    case 'switch':
      return raw === 'true' || Number(raw) > 0 ? i18n.t('configChange.on') : i18n.t('configChange.off');
    case 'time': {
      // The document keeps seconds past midnight UTC; the reader thinks in the
      // clock on the wall. A line is resolved without the account at hand, so
      // that is the wall this screen hangs on, which is the account's own for
      // everybody who has not moved their account to another zone.
      const seconds = Number(raw);
      return Number.isFinite(seconds) ? wallClock(seconds, offsetOf(serverNow(), null)) : raw;
    }
    case 'number': {
      const number = Number(raw);
      if (!Number.isFinite(number)) return raw;
      return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(number)} ${field.unit ?? ''}`.trim();
    }
  }
};

/** One line of the change, named and written out where the figure is one the app sets. */
const lineOf = (i18n: I18n, line: string): string => {
  const match = LINE.exec(line);
  const field = match ? FIELDS[match[1]] : undefined;
  if (!match || !field) return line;

  return `${i18n.t(`configChange.field.${match[1]}`)}: ${valueOf(i18n, field, match[2])} → ${valueOf(i18n, field, match[3])}`;
};

/** The whole of what moved, a line each. */
export const configurationChange = (i18n: I18n, value: string): string =>
  value
    .split('\n')
    .map(line => lineOf(i18n, line))
    .join('\n');

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
