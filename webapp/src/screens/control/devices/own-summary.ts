import type { Device, Metric } from '@fg2/shared-types/v1';
import {
  PLUG_SWITCHING,
  switchPointName,
  type PlugMode,
  type PlugSwitching,
  type TimerWindow,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { fieldValue } from '@/ui/advanced/field-values';
import { targetFigure, UNIT } from '../../home/units';
import { wallClock } from '../targets/targets-draft';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What a smart socket is set to, in the few lines the cockpit's summary has:
 * what it switches by, and the points or the windows it switches at. The
 * cockpit says what is true and Steuerung is where it is changed, so this is
 * read from the device's own document and never drawn as a control.
 */

export interface SummaryRow {
  label: string;
  parts: string[];
}

const READING: Record<PlugSwitching | 'co2', Metric> = {
  heater: 'temperature',
  cooler: 'temperature',
  humidify: 'humidity',
  dehumidify: 'humidity',
  co2: 'co2',
};

const RISING: readonly string[] = ['heater', 'humidify', 'co2'];

const DAY_SECONDS = 24 * 60 * 60;

const withUnit = (value: number, metric: Metric): string => `${targetFigure(value, metric)} ${UNIT[metric] ?? ''}`.trim();

const number = (device: Device, name: string): number | null => {
  const value = fieldValue(device, name);
  return typeof value === 'number' ? value : null;
};

/** The mode a socket switches by, or null for a document that says none - or a device that is no socket. */
export const plugModeOf = (device: Device | null): PlugMode | null => {
  if (device?.type !== 'plug') return null;
  const mode = fieldValue(device, 'plugMode');
  return typeof mode === 'string' ? (mode as PlugMode) : null;
};

export const plugSummaryOf = (t: Translate, device: Device, offset: number): SummaryRow[] | null => {
  const mode = plugModeOf(device);
  if (!mode) return null;

  const rows: SummaryRow[] = [{ label: t('plugSettings.mode.label'), parts: [t(`plugSettings.mode.${mode}`)] }];
  const dayNight = fieldValue(device, 'dayNight') === true;

  const pair = (switching: PlugSwitching | 'co2', when: 'day' | 'night'): string | null => {
    const on = number(device, switching === 'co2' ? 'co2On' : switchPointName(switching, when, 'on'));
    const off = number(device, switching === 'co2' ? 'co2Off' : switchPointName(switching, when, 'off'));
    if (on === null || off === null) return null;
    const metric = READING[switching];
    return t(`plugSettings.summary.${RISING.includes(switching) ? 'rising' : 'falling'}`, { on: withUnit(on, metric), off: withUnit(off, metric) });
  };

  if ((PLUG_SWITCHING as readonly string[]).includes(mode)) {
    const switching = mode as PlugSwitching;
    const day = pair(switching, 'day');
    const night = dayNight ? pair(switching, 'night') : null;
    if (day) rows.push({ label: t(dayNight ? 'cockpit.targets.day' : 'plugSettings.points'), parts: [day] });
    if (night) rows.push({ label: t('cockpit.targets.night'), parts: [night] });
  }

  if (mode === 'co2') {
    const points = pair('co2', 'day');
    if (points) rows.push({ label: t('plugSettings.points'), parts: [points, ...(dayNight ? [t('plugSettings.summary.dayOnly')] : [])] });
  }

  if (mode === 'timer') {
    const windows = (fieldValue(device, 'timerWindows') as TimerWindow[] | null) ?? [];
    rows.push({
      label: t('plugSettings.windows.label'),
      parts:
        windows.length > 0
          ? windows.map(window => `${wallClock(window.ontime, offset)}–${wallClock((window.ontime + window.duration * 60) % DAY_SECONDS, offset)}`)
          : [t('plugSettings.summary.noWindows')],
    });
  }

  return rows;
};

/**
 * What the cockpit's first line says where nothing here holds targets but a
 * stand-alone module is set to something of its own: "no targets yet" would
 * send a socket's owner looking for a setting they have already made.
 */
export const ownStatusOf = (t: Translate, device: Device | null, offset: number): string | null => {
  const mode = plugModeOf(device);
  if (mode) return t('ownPanel.status', { mode: t(`plugSettings.mode.${mode}`) });

  if (device?.type === 'light' && device.configuration) {
    const on = number(device, 'lightsOn');
    const off = number(device, 'lightsOff');
    if (on !== null && off !== null) return t('ownPanel.statusLight', { on: wallClock(on, offset), off: wallClock(off, offset) });
  }

  return null;
};

/**
 * The one line a stand-alone module's panel on the Devices tab says about what
 * it is set to, linked to Steuerung where it is changed: what a socket switches
 * by, what a fan's speed follows, when a lamp is on.
 */
export const ownFactOf = (t: Translate, device: Device, offset: number): { label: string; value: string } | null => {
  if (!device.configuration) return null;

  if (device.type === 'plug') {
    const mode = plugModeOf(device);
    return mode ? { label: t('plugSettings.mode.label'), value: t(`plugSettings.mode.${mode}`) } : null;
  }
  if (device.type === 'fan') {
    const mode = fieldValue(device, 'fanMode');
    return typeof mode === 'string' ? { label: t('fanSettings.mode.label'), value: t(`fanSettings.mode.${mode}`) } : null;
  }
  if (device.type === 'light') {
    const on = number(device, 'lightsOn');
    const off = number(device, 'lightsOff');
    return on !== null && off !== null ? { label: t('lightSettings.title'), value: `${wallClock(on, offset)}–${wallClock(off, offset)}` } : null;
  }

  return null;
};
