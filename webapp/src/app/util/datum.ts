import { formatDate } from '@angular/common';
import { resolveAppLocale } from './locale';
import { pluralSchluessel } from './zahl';

/**
 * A moment, in the reader's language and without seconds. `toLocaleString()`
 * printed `24.8.2026, 14:02:37` - a precision nobody watering a tent has, on a
 * clock the browser picked rather than the app.
 */
export const datumZeitText = (t: number, locale: string = resolveAppLocale()): string => formatDate(t, 'short', locale);

/** A day, without a time. */
export const datumText = (t: number, locale: string = resolveAppLocale()): string => formatDate(t, 'shortDate', locale);

/**
 * `Freitag`. A sentence about a diary says which day it means the way a person
 * would - „zuletzt eingetragen am Freitag", not „am 22.08.".
 */
export const wochentagText = (t: number, locale: string = resolveAppLocale()): string => formatDate(t, 'EEEE', locale);

/**
 * A span of time the way the drawn screens print one: `2 Std 40`, `45 Min`,
 * `3 Tage`. Hours and minutes rather than a decimal, because „die Heizung lief
 * 2,67 Std" is not a sentence anybody says.
 *
 * The words are looked up by the caller through the returned key, so this stays
 * a pure shape and the language stays in the bundles.
 */
export interface Dauer {
  key: string;
  params: Record<string, number>;
}

const MINUTE = 60 * 1000;
const STUNDE = 60 * MINUTE;
const TAG = 24 * STUNDE;

export const dauer = (ms: number): Dauer => {
  const gerundet = Math.max(0, Math.round(ms));

  if (gerundet >= TAG) {
    const tage = Math.round(gerundet / TAG);
    return { key: pluralSchluessel('zelt.dauer.tage', tage), params: { tage: tage } };
  }
  if (gerundet >= STUNDE) {
    return {
      key: 'zelt.dauer.stunden',
      params: { stunden: Math.floor(gerundet / STUNDE), minuten: Math.floor((gerundet % STUNDE) / MINUTE) },
    };
  }
  const minuten = Math.max(1, Math.floor(gerundet / MINUTE));
  return { key: pluralSchluessel('zelt.dauer.minuten', minuten), params: { minuten: minuten } };
};
