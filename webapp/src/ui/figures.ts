import i18next from 'i18next';
import type { WeekClimate } from '@fg2/shared-types/v1';

/**
 * How a figure is written, and in whose language: German writes "24,5 °C" and
 * English "24.5 °C", which `toFixed` cannot, so every reading and file size a
 * person reads becomes a string here. Machine text - an ISO instant, a date
 * field's value, a CSV cell, an id, an SVG path - stays on `toFixed`, and the
 * sweep in `test/figures.test.ts` says so.
 */

/**
 * The language the app is being read in, chosen on the Appearance page - the
 * same answer `i18n.ts` gives Luxon, so a figure and the date beside it agree.
 * Before the catalogue has loaded the browser decides.
 */
const readerLanguage = (): string | undefined => i18next.language || undefined;

/**
 * A number as this reader writes it, to a fixed number of decimals. Grouping is
 * off, because one language's thousands separator is the other's decimal point
 * ("1.600" against "1,600"), and a reading never has more than four digits.
 */
export const decimalFigure = (value: number, decimals: number, language: string | undefined = readerLanguage()): string =>
  new Intl.NumberFormat(language, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(value);

/**
 * A figure the reader typed, read back whichever way their language writes the
 * decimals - "5,8" or "5.8". Nothing typed, or something that is not a number,
 * is null.
 */
export const typedFigure = (typed: string): number | null => {
  const trimmed = typed.trim();
  const value = Number(trimmed.replace(',', '.'));

  return trimmed !== '' && Number.isFinite(value) ? value : null;
};

/** A figure to fixed decimals, or a dash where there is none. */
export const dashFigure = (value: number | null, decimals: number): string => (value === null ? '–' : decimalFigure(value, decimals));

/** "25.1 / 22.1" where the controller told day from night; the plain mean where it did not. */
export const dayNightFigure = (row: WeekClimate | undefined, decimals: number): string =>
  row?.dayAverage !== null && row?.dayAverage !== undefined
    ? `${dashFigure(row.dayAverage, decimals)} / ${dashFigure(row.nightAverage, decimals)}`
    : dashFigure(row?.averageValue ?? null, decimals);

/** Spaces that do not break, so a narrow line breaks between two figures and never inside one - between a number and its unit. */
export const unbroken = (text: string): string => text.replace(/ /g, '\u00a0');

/** As many decimals as a typed measurement is worth, so a pH stored as 6.500000000000001 reads "6.5". */
const MOST_DECIMALS = 3;

/**
 * A number written as exactly as it was measured, with no trailing noughts: a
 * logged 6.5 pH or 1.2 EC. A figure that rounds to nothing is "0", never "-0",
 * since this also writes the change between two readings.
 */
export const looseFigure = (value: number, language: string | undefined = readerLanguage()): string => {
  const rounded = Number(value.toFixed(MOST_DECIMALS));

  return new Intl.NumberFormat(language, { maximumFractionDigits: MOST_DECIMALS, useGrouping: false }).format(rounded === 0 ? 0 : rounded);
};

/**
 * "1.2 GB", "12.4 MB", or "44 kB" for a grow with no pictures in it yet. The
 * unit changes because it has to at both ends: a diary of a fortnight rounds
 * to 0.0 MB, and a download that says it is nothing reads as an export that
 * went wrong - while a whole account with a year of diary photos and films in
 * it is a gigabyte and more, and four digits of megabytes is a figure nobody
 * can weigh against the room on their disk.
 *
 * The steps are the binary ones under the SI labels, which is what this app
 * writes a size in everywhere, so the same zip reads the same on the account
 * page and on the administrator's health card. The decimal is always written
 * where there is room for one, because "1 GB" beside "1.2 GB" reads as the
 * rounder of two answers rather than as the same kind of figure.
 *
 * The decimal itself is `decimalFigure`'s and never the caller's, for the
 * reason given at the top of this file.
 */
export const fileSize = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${decimalFigure(bytes / 1024 ** 3, 1)} GB`;
  if (bytes >= 1024 ** 2) return `${decimalFigure(bytes / 1024 ** 2, 1)} MB`;

  return `${decimalFigure(Math.round(bytes / 1024), 0)} kB`;
};
