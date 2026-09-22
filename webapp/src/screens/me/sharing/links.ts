import { DateTime } from 'luxon';
import type { ShareLink } from '@fg2/shared-types/v1';
import { appUrl } from '@/ui/clipboard';

/**
 * What the share-links page works out from a link, kept apart from the
 * drawing so that the tests can ask the same questions of the same answers.
 * Every instant here is one the server wrote; nothing is an age.
 */

/**
 * Whether a link has stopped: taken back, or past the instant it was given.
 * The second half is the one comparison against this browser's clock the page
 * makes, and only to sort a card under the right label - what the card says
 * is the server's date.
 */
export const isDead = (link: ShareLink, now: DateTime): boolean =>
  link.revokedAt !== null || (link.expiresAt !== null && DateTime.fromISO(link.expiresAt) <= now);

/**
 * How long a link was made for, in whole days, from the two instants the
 * server answers - which is what the board writes after the kind ("7 days")
 * and what the sheet asked. Null for a link with no end.
 */
export const lifetimeDays = (link: ShareLink): number | null => {
  if (link.expiresAt === null) return null;
  const days = Math.round(DateTime.fromISO(link.expiresAt).diff(DateTime.fromISO(link.createdAt), 'days').days);

  return days >= 1 ? days : null;
};

/** "22 Sep", and the year only where it is not this one. */
export const dayLabel = (at: string, now: DateTime, locale: string): string => {
  const day = DateTime.fromISO(at).setLocale(locale);

  return day.toFormat(day.year === now.year ? 'd LLL' : 'd LLL yyyy');
};

/** The address handed out: the token's, for both kinds, because opening it is what the server counts. */
export const linkAddress = (link: ShareLink): string => appUrl(`/shared/${link.token}`);
