import type { DateTime } from 'luxon';
import type { Device, Metric, PendingSetting, PendingSettings } from '@fg2/shared-types/v1';
import {
  CONFIGURATION_FIELDS,
  TARGET_RANGES,
  configurationFieldsOf,
  type ConfigurationField,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import type { Translate } from '@/i18n/i18n';
import type { ClimateChoice } from '@/ui/presets';
import { unbroken } from '@/ui/figures';
import { figureWithUnit } from '@/ui/units';
import { CLOCK, DATED_CLOCK, nowThere, zoned } from '@/ui/zone';
import type { Field, Half, Regime } from '../targets/day-night';
import type { LightSchedule, TargetsDraft } from '../targets/targets-draft';

/**
 * The figures Steuerung sets one at a time: where each stands in the device's
 * document, the range the server holds a hand's write to (`TARGET_RANGES`), and
 * what it is called.
 */

export type FigureField = Exclude<Field, 'lightsOn' | 'lightHours'>;

interface Spec {
  metric: Metric | 'light';
  half: Half | null;
  /** The dotted path in the device's document, which is how a setting the device has not been handed is named. */
  path: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
}

const spec = (metric: Spec['metric'], half: Half | null, path: keyof typeof TARGET_RANGES, decimals: number): Spec => ({
  metric,
  half,
  path,
  ...TARGET_RANGES[path],
  decimals,
});

export const FIGURES: Record<FigureField, Spec> = {
  dayTemperature: spec('temperature', 'day', 'day.temperature', 1),
  nightTemperature: spec('temperature', 'night', 'night.temperature', 1),
  dayHumidity: spec('humidity', 'day', 'day.humidity', 0),
  nightHumidity: spec('humidity', 'night', 'night.humidity', 0),
  co2: spec('co2', 'day', 'co2.target', 0),
  lightLimit: spec('light', null, 'lights.limit', 0),
};

/** The two paths a light window is stored under. */
const WINDOW_PATHS = ['daynight.day', 'daynight.night'] as const;

/**
 * "25,0 °C", "60 %", "900 ppm", "65 %": a figure as its button and its sentence write it. Every figure of a
 * reading carries that reading's decimals, so "25,0 °C" stands beside "21,5 °C".
 */
export const figureText = (field: FigureField, value: number): string =>
  unbroken(field === 'lightLimit' ? `${Math.round(value)} %` : figureWithUnit(value, FIGURES[field].metric as Metric));

/**
 * What a figure is called: "Temperatur am Tag", and by the spell where the
 * device holds one climate round the clock ("Temperatur in der Trocknung").
 */
export const figureName = (t: Translate, field: FigureField, regime: Regime): string => {
  if (field === 'co2' || field === 'lightLimit') return t(`targets.aria.${field}`);
  const kind = FIGURES[field].metric === 'temperature' ? 'Temperature' : 'Humidity';
  return regime === 'drying' || regime === 'germination' ? t(`targets.aria.${regime}${kind}`) : t(`targets.aria.${field}`);
};

/* ------------------------------------------------- what the device has not taken */

/** "um 14:31" today, "am 3. Nov 14:31" on any other day: when a setting the device has not taken was stored. */
export const savedWords = (t: Translate, at: string, now: DateTime, zone: string | null): string => {
  const when = zoned(at, zone);
  return when.hasSame(nowThere(now, zone), 'day')
    ? t('control.pending.atClock', { time: when.toFormat(CLOCK) })
    : t('control.pending.atDay', { time: when.toFormat(DATED_CLOCK) });
};

/** The settings a silent device has not been handed, by their path. */
export const pendingByPath = (pending: PendingSettings | null | undefined): ReadonlyMap<string, PendingSetting> =>
  new Map((pending?.settings ?? []).map(setting => [setting.field, setting]));

/** What the device still holds for a figure it has not been handed; undefined where the figure is not pending. */
export const pendingFigure = (pending: ReadonlyMap<string, PendingSetting>, field: FigureField): PendingSetting | undefined =>
  pending.get(FIGURES[field].path);

/**
 * The light window a silent device still runs, where the one stored since
 * differs: the two times it was last handed, the one that did not move read
 * from what is stored now.
 */
export const pendingWindow = (
  pending: ReadonlyMap<string, PendingSetting>,
  stored: { day: number | null; night: number | null },
): { held: LightSchedule | null; savedAt: string } | null => {
  const [day, night] = WINDOW_PATHS.map(path => pending.get(path));
  if (!day && !night) return null;
  const figure = (setting: PendingSetting | undefined, now: number | null) =>
    setting ? (typeof setting.held === 'number' ? setting.held : null) : now;
  const savedAt = [day?.savedAt, night?.savedAt]
    .filter((at): at is string => at !== undefined)
    .sort()
    .at(-1)!;
  const heldDay = figure(day, stored.day);
  const heldNight = figure(night, stored.night);

  return { held: heldDay === null || heldNight === null ? null : lightWindowOf(heldDay, heldNight), savedAt };
};

/** The setting of a device's document a name of `CONFIGURATION_FIELDS` stands for, or undefined. */
export const fieldOf = (device: Pick<Device, 'type'>, name: string): ConfigurationField | undefined => configurationFieldsOf(device.type)[name];

/** What the device still holds for a setting named as `CONFIGURATION_FIELDS` names it; undefined where it is not pending. */
export const pendingField = (pending: ReadonlyMap<string, PendingSetting>, device: Pick<Device, 'type'>, name: string): PendingSetting | undefined =>
  pending.get(fieldOf(device, name)?.path ?? '');

/** What a Plantalytix Socket, an AIR fan and a LIGHT show where a controller's climate stands: every setting but the fine ones, which are Erweitert's. */
const FINE: Readonly<Record<string, RegExp | null>> = {
  plug: /^(co2Dosing|co2Every|co2For|overheat|cold|least)/,
  fan: null,
  light: /^(sunrise|sunset|overheat)/,
};
const OWN_PATHS = Object.entries(FINE).flatMap(([type, fine]) =>
  Object.entries(CONFIGURATION_FIELDS[type]).flatMap(([name, field]) => (field.path === null || fine?.test(name) ? [] : [field.path])),
);

/** The paths Steuerung's own cards say, so whatever else is pending is counted on the device's card. */
export const SAID_ON_CARDS: readonly string[] = [...Object.values(FIGURES).map(spec => spec.path), ...WINDOW_PATHS, ...OWN_PATHS];

/** The paths behind the row "Betriebsart" and the row "Ausgänge". */
export const MODE_PATHS: readonly string[] = ['workmode'];
export const isOutputPath = (path: string): boolean => path.startsWith('fans.');

/** One setting a silent device has not been handed: what is stored, since when, and what the device still holds. */
export interface PendingItem {
  name: string;
  value: string;
  /** What the device still holds, as the page writes it; null where the cloud does not know. */
  held: string | null;
  savedAt: string;
  /** What is held is one thing rather than a figure - a mode, a window - which German says in the singular. */
  one?: boolean;
  /** Regulation switched on, which has its own sentence as a switch-off has. */
  switchedOn?: boolean;
}

/** The firmware's word for a work mode, in the app's: the one catalogue key both the stored and the held mode are said with. */
const MODE_KEYS: Readonly<Record<string, string>> = {
  off: 'control.state.off',
  small: 'operatingMode.standard',
  full: 'operatingMode.standard',
  temp: 'operatingMode.greenhouse',
  breed: 'operatingMode.germination',
  dry: 'operatingMode.drying',
};

/**
 * The work mode stored for a silent device that still runs another: what is
 * stored, and what it was last handed. A fridge's energy saving is a work
 * mode of the firmware's too (`full`), and is said as the switch it is.
 */
export const pendingMode = (t: Translate, device: Device, pending: ReadonlyMap<string, PendingSetting>): PendingItem | null => {
  const held = pending.get(MODE_PATHS[0]);
  const control = device.control;
  if (!held || !control) return null;
  const heldKey = MODE_KEYS[String(held.held)] ?? null;
  const storedKey = !control.running ? MODE_KEYS.off : `operatingMode.${control.drying ? 'drying' : control.mode}`;
  const onOff = (on: boolean) => t(`climateControl.state.${on ? 'on' : 'off'}`);
  // Switched on while the device held none, it is named as what it is - "Regelung an" - and not as the mode it comes back to.
  if (heldKey === MODE_KEYS.off && control.running) {
    return { name: t('climateControl.label'), value: onOff(true), held: onOff(false), savedAt: held.savedAt, one: true, switchedOn: true };
  }

  return heldKey === storedKey && storedKey === MODE_KEYS.small
    ? { name: t('energySaving.label'), value: onOff(control.energySaving), held: onOff(held.held === 'full'), savedAt: held.savedAt, one: true }
    : { name: t('operatingMode.label'), value: t(storedKey), held: heldKey ? t(heldKey) : null, savedAt: held.savedAt, one: true };
};

/** Whether a draft's figure differs from another's, for the fields a sheet moved. */
export const movedFields = (next: TargetsDraft, before: TargetsDraft): FigureField[] =>
  (Object.keys(FIGURES) as FigureField[]).filter(field => next[field] !== before[field]);

/** Whether a preset starts or ends one of the two stages that are a mode of the device as well. */
export const spellChangeOf = (chip: ClimateChoice | null, device: Device, spell: 'drying' | 'germination'): 'starts' | 'ends' | null => {
  const control = device.control;
  if (!chip || !control) return null;
  const wanted = chip.stage === spell;
  const running = spell === 'drying' ? control.drying : !control.drying && control.mode === 'germination';
  return wanted === running ? null : wanted ? 'starts' : 'ends';
};

/** "Plan: „Blüte“ setzt die Lichtzeiten und die Lichtgrenze – jede Stunde neu.", for what of the lamp a running plan writes; null where it writes none. */
export const planWords = (t: Translate, name: string, owned: ReadonlySet<Field>): string | null => {
  const times = owned.has('lightHours') || owned.has('lightsOn');
  const limit = owned.has('lightLimit');
  if (!times && !limit) return null;
  return t('control.light.planSets', { name, what: t(`control.light.planWhat.${times && limit ? 'both' : times ? 'times' : 'limit'}`) });
};
