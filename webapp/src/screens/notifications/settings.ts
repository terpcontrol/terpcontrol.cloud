import { DateTime } from 'luxon';
import type { NotificationCategory, NotificationChannel, NotificationRouting, QuietHours } from '@fg2/shared-types/v1';
import { zoned } from '@/ui/zone';

/**
 * The arithmetic of the notification settings, kept apart from the screen so
 * that what a switch sends can be checked without drawing it.
 *
 * The routing is a grid of categories against channels, and the server takes
 * it whole - so every move here answers a complete object with one cell
 * changed and nothing else touched.
 */

/** The rows of the grid, in the order the board draws them: what wakes you first. */
export const CATEGORIES: NotificationCategory[] = ['alerts', 'warnings', 'tasks', 'plan', 'weekly_timelapse'];

/** The columns, in the order of the cards above them. */
export const CHANNELS: NotificationChannel[] = ['push', 'telegram', 'email', 'webhook'];

export const routes = (routing: NotificationRouting, category: NotificationCategory, channel: NotificationChannel): boolean =>
  (routing[category] ?? []).includes(channel);

/** The grid with one cell flipped. A channel already where it is asked to go is left there once, not twice. */
export const routingWith = (
  routing: NotificationRouting,
  category: NotificationCategory,
  channel: NotificationChannel,
  on: boolean,
): NotificationRouting => {
  const current = routing[category] ?? [];
  const next = on ? (current.includes(channel) ? current : [...current, channel]) : current.filter(one => one !== channel);

  return { ...routing, [category]: next };
};

/** What a channel would carry, for the line under its card. */
export const categoriesOn = (routing: NotificationRouting, channel: NotificationChannel): NotificationCategory[] =>
  CATEGORIES.filter(category => routes(routing, category, channel));

/** "critical and warnings", "Kritisches, Warnungen und fällige Aufgaben": the language's own way of listing. */
export const listed = (items: string[], language: string): string => {
  try {
    return new Intl.ListFormat(language, { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
};

/**
 * Quiet hours are minutes from midnight on the person's own clock, and the
 * time field speaks "HH:mm"; these are the two directions between them. A
 * field that is being typed into can hold no time at all for a moment, which
 * is answered as null rather than as midnight.
 */
export const minuteOf = (time: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const timeOf = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** The window the board draws, and what switching quiet hours on starts from. */
export const DEFAULT_QUIET: QuietHours = { fromMinute: 23 * 60, toMinute: 7 * 60 };

/** The host a webhook goes to, which is the part of it worth reading on a card; the rest is the person's secret. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const isMuted = (mutedUntil: string | null, now: DateTime): boolean => mutedUntil !== null && DateTime.fromISO(mutedUntil) > now;

/**
 * A clock time for a line, or the date with it when the instant is not today's
 * - both in the account's own zone, which is the zone the window above them is
 * read in and the only one in which "until 07:00" means what it says.
 */
export const clockLabel = (instant: string, now: DateTime, zone: string | null): string => {
  const at = zoned(instant, zone);
  const here = zone ? now.setZone(zone) : now;

  return at.hasSame(here, 'day') ? at.toLocaleString(DateTime.TIME_SIMPLE) : at.toLocaleString(DateTime.DATETIME_SHORT);
};
