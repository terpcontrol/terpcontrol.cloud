import { formatDate } from '@angular/common';
import { resolveAppLocale } from './locale';

/**
 * A moment, in the reader's language and without seconds. `toLocaleString()`
 * printed `24.8.2026, 14:02:37` - a precision nobody watering a tent has, on a
 * clock the browser picked rather than the app.
 */
export const datumZeitText = (t: number, locale: string = resolveAppLocale()): string => formatDate(t, 'short', locale);

/** A day, without a time. */
export const datumText = (t: number, locale: string = resolveAppLocale()): string => formatDate(t, 'shortDate', locale);
