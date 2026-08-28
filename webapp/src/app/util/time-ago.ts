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
    // The library's German for „less than a minute ago" is `gerade jetzt`,
    // which is not German. It is also the string at the top of every screen a
    // device owner opens - `Werte von gerade eben`.
    // The `now` style is a `{ now: … }` label set rather than the per-unit map
    // the published typings describe for `addLabels`, hence the cast.
    const geradeEben = { now: { current: 'gerade eben', past: 'gerade eben', future: 'gerade eben' } };
    TimeAgo.addLabels('de', 'now', geradeEben as unknown as Parameters<typeof TimeAgo.addLabels>[2]);
    formatter = new TimeAgo(resolveAppLocale());
  }
  return formatter;
}

export function formatTimeAgo(value: Date | string | number): string {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';

  // Nothing in this product is reported from the future. A device whose clock
  // runs two minutes fast was still heard from just now, and saying
  // `Werte von in 2 Minuten` only makes the reader doubt the screen.
  return timeAgo().format(Math.min(t, Date.now()));
}
