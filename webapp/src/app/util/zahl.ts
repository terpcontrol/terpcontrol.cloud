import { formatNumber } from '@angular/common';
import { resolveAppLocale } from './locale';

/**
 * Every number a reader sees goes through here. ngx-translate interpolates by
 * string replace, so a raw `2.5` handed to `{{liter}} l` renders an English
 * decimal point next to a German one from the `number` pipe three sections
 * further down. One path, one separator.
 */
export const zahlText = (wert: number, nachkomma = 1, locale: string = resolveAppLocale()): string =>
  formatNumber(wert, locale, `1.0-${nachkomma}`);

/**
 * The plural form of a key, as the reader's language counts.
 *
 * ngx-translate has no ICU support out of the box, and the message-format
 * compiler would put a second syntax into every bundle for the four counted
 * strings this product has. `Intl.PluralRules` already knows the categories,
 * and a `key.one` / `key.other` pair is a nested object the bundles hold
 * anyway - so the choice is made here and the bundle stays plain JSON.
 *
 * German and English both produce `one` and `other`; a language with more
 * categories names them itself and only needs the keys added.
 */
export const pluralSchluessel = (schluessel: string, anzahl: number, locale: string = resolveAppLocale()): string =>
  `${schluessel}.${new Intl.PluralRules(locale).select(anzahl)}`;
