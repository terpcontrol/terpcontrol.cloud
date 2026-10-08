import i18next from 'i18next';
import type { WeekClimate } from '@fg2/shared-types/v1';

/**
 * How a figure is written, and in whose language.
 *
 * A decimal point is not punctuation the way a full stop is: German writes
 * "24,5 °C" and English writes "24.5 °C", and the app wrote the English one
 * either way because every reading reached the screen through `toFixed`, which
 * knows no language at all. So the whole German app read its own tent back in
 * somebody else's numbers - "0.98 kPa VPD · kein Ziel" - and did it on every
 * screen that carries a reading, which is most of them.
 *
 * The app already stated the rule elsewhere: `api/exports.ts` wrote a file size
 * with `Intl.NumberFormat` of its own precisely so that a size is written the
 * way the language writes a decimal, and `i18n/i18n.ts` says the same of dates.
 * This is that rule for readings, in one place, because a reading becomes a
 * string in enough screens that patching them one at a time is how half of them
 * would stay wrong.
 *
 * A file size is one of them, and it is here for the reason the rest are. It
 * asked each caller for the language instead of asking the app, two of three
 * callers answered, and the third put "171.9 MB" on a German page under its own
 * "18,5 °C". `fileSize` at the end of this file now rounds a byte count to its
 * unit and writes the number as every reading is written.
 *
 * What does not belong here: an ISO instant, a `yyyy-MM-dd` a date field
 * speaks, a CSV cell, an id, a firmware version, a co-ordinate in an SVG path.
 * None of those is a figure anybody reads as a quantity - they are addresses,
 * keys and machine input, and a comma in the middle of one either breaks the
 * consumer or, in a path, draws nothing at all. They stay on `toFixed` and on
 * plain string arithmetic, and the sweep in `test/figures.test.ts` says so.
 */

/**
 * The language the app is being read in, which is chosen on the Appearance
 * page and not read from the browser - the same answer `i18n.ts` gives Luxon
 * for dates, so a figure and the date beside it cannot disagree about who is
 * reading them. Nothing having answered yet leaves the browser to it, which is
 * the best guess available before the catalogue has loaded.
 */
const readerLanguage = (): string | undefined => i18next.language || undefined;

/**
 * A number as this reader writes it, to a fixed number of decimals.
 *
 * Grouping is off on purpose. The separator that groups thousands is the other
 * language's decimal point - German groups with the full stop English decimates
 * with - so a CO2 reading grouped into "1.600" in German sits one screen away
 * from an English "1,600" and a reader who has seen both has no way to be sure
 * which of the two is sixteen hundred. A reading has four digits at the very
 * most, so nothing is lost by leaving them together.
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

/**
 * As many decimals as a measurement anybody types is ever worth. It is the
 * rounding the reading path already did before this existed, kept so that a pH
 * stored as 6.500000000000001 goes on reading "6.5".
 */
const MOST_DECIMALS = 3;

/**
 * A number written as exactly as it was measured, with whatever decimals it
 * turned out to have and no trailing noughts - what a logged measurement of
 * 6.5 pH or 1.2 EC is worth saying to.
 *
 * A figure that rounds away to nothing is written as nothing rather than as
 * "-0", the same rule a card's reading follows: this also writes the change
 * between two readings, and nothing ever fell by minus nothing.
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
