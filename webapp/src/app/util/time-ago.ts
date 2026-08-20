import TimeAgo from 'javascript-time-ago';
import de from 'javascript-time-ago/locale/de';
import en from 'javascript-time-ago/locale/en';
import { resolveAppLocale } from './locale';

let formatter: TimeAgo | null = null;

/**
 * Shared relative-time formatter in the app's language. Registering the
 * locales is a one-shot global in javascript-time-ago, so every caller has to
 * go through here instead of setting it up per component.
 */
export function timeAgo(): TimeAgo {
  if (!formatter) {
    TimeAgo.addDefaultLocale(en);
    TimeAgo.addLocale(de);
    formatter = new TimeAgo(resolveAppLocale());
  }
  return formatter;
}

export function formatTimeAgo(value: Date | string | number): string {
  return timeAgo().format(new Date(value));
}
