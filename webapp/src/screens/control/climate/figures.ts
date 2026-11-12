import type { DateTime } from 'luxon';
import type { Device, Metric, PendingSetting, PendingSettings } from '@fg2/shared-types/v1';
import { lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import type { Translate } from '@/i18n/i18n';
import type { ClimateChoice } from '@/ui/presets';
import { unbroken } from '@/ui/figures';
import { targetWithUnit } from '@/ui/units';
import { CLOCK, DATED_CLOCK, nowThere, zoned } from '@/ui/zone';
import type { Field, Half, Regime } from '../targets/day-night';
import type { LightSchedule, TargetsDraft } from '../targets/targets-draft';

/**
 * The figures Steuerung sets one at a time: where each stands in the device's
 * document, the range its stepper keeps it in, and what it is called.
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

const TEMPERATURE = { metric: 'temperature', min: 15, max: 35, step: 0.5, decimals: 1 } as const;
const HUMIDITY = { metric: 'humidity', min: 30, max: 90, step: 1, decimals: 0 } as const;

export const FIGURES: Record<FigureField, Spec> = {
  dayTemperature: { ...TEMPERATURE, half: 'day', path: 'day.temperature' },
  nightTemperature: { ...TEMPERATURE, half: 'night', path: 'night.temperature' },
  dayHumidity: { ...HUMIDITY, half: 'day', path: 'day.humidity' },
  nightHumidity: { ...HUMIDITY, half: 'night', path: 'night.humidity' },
  co2: { metric: 'co2', half: 'day', path: 'co2.target', min: 400, max: 1500, step: 50, decimals: 0 },
  lightLimit: { metric: 'light', half: null, path: 'lights.limit', min: 0, max: 100, step: 5, decimals: 0 },
};

/** The two paths a light window is stored under. */
export const WINDOW_PATHS = ['daynight.day', 'daynight.night'] as const;

/** "25,0 °C", "60 %", "900 ppm", "65 %": a figure as its button and its sentence write it. */
export const figureText = (field: FigureField, value: number): string =>
  unbroken(field === 'lightLimit' ? `${Math.round(value)} %` : targetWithUnit(value, FIGURES[field].metric as Metric));

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

/** The paths Steuerung's own cards say, so whatever else is pending is counted on the device's card. */
export const SAID_ON_CARDS: readonly string[] = [...Object.values(FIGURES).map(spec => spec.path), ...WINDOW_PATHS];

/** The paths behind the row "Betriebsart" and the row "Ausgänge". */
export const MODE_PATHS: readonly string[] = ['workmode'];
export const isOutputPath = (path: string): boolean => path.startsWith('fans.');

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
