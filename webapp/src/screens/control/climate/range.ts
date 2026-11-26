import { ApiError } from '@/api/problem';
import type { Translate } from '@/i18n/i18n';
import { unbroken } from '@/ui/fact-text';
import { decimalFigure } from '@/ui/figures';

/** A figure's range as a sheet or a stepper keeps it. */
export interface Range {
  min: number;
  max: number;
  decimals: number;
  unit?: string;
}

/** A range's end as few decimals as it has: "15", "0,5", "0,005". */
const written = (value: number, decimals: number): string =>
  decimalFigure(value, decimals)
    .replace(/([.,]\d*?)0+$/, '$1')
    .replace(/[.,]$/, '');

/**
 * Why a typed figure is not saved, named by its field and its range - "Temperatur
 * am Tag: Das geht nur zwischen 15 und 35 °C." - or null where it may be. A
 * figure outside its range is refused, never brought into it: what is written
 * to a device is what was typed or nothing.
 */
export const rangeRefusal = (t: Translate, name: string, value: number, range: Range): string | null => {
  if (!Number.isFinite(value)) return t('control.refused.number', { name });
  return value >= range.min && value <= range.max ? null : rangeSaid(t, name, range);
};

/** "Temperatur am Tag: Das geht nur zwischen 15 und 35 °C." */
export const rangeSaid = (t: Translate, name: string, { min, max, decimals, unit }: Range): string =>
  t('control.refused.range', {
    name,
    min: written(min, decimals),
    max: unbroken(unit ? `${written(max, decimals)} ${unit}` : written(max, decimals)),
  });

/** The codes a server answers a figure out of its range with (400 `validation_failed`, each error by its field). */
const OUT_OF_RANGE = new Set(['too_big', 'too_small', 'out_of_range']);

/** Whether a write was refused for a figure out of its range, which the sheet then says in its own words. */
export const refusedForRange = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.status === 400 || error.status === 422) &&
  (OUT_OF_RANGE.has(error.problem.code) || error.problem.errors.some(one => OUT_OF_RANGE.has(one.code)));
