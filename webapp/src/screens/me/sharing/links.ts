import { DateTime } from 'luxon';
import type { GrowOrSpaceRef, ShareLink } from '@fg2/shared-types/v1';
import { DAY, DAY_IN_YEAR, nowThere, zoned } from '@/ui/zone';
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
 * Whether a link onto this subject could carry camera pictures: a place with a camera standing in it, or a grow of an
 * account with a camera anywhere. The sheet that makes a link offers the pictures only there, and the card of a link
 * says whether it carries them only there - "Kamerabilder aus" for a place without a camera answers nothing asked.
 */
export const picturesPossible = (cameras: readonly { spaceId: string | null }[], subject: GrowOrSpaceRef): boolean =>
  cameras.some(camera => subject.type !== 'space' || camera.spaceId === subject.id);

/**
 * "22 Sep", and the year only where it is not this one - read where the
 * account is, because which day a link began or expired on is a day boundary
 * and moves with the zone it is asked in.
 *
 * Now is moved into that zone before the two years are compared, because a
 * year is a day boundary as well: on New Year's Eve a browser and an account on
 * either side of midnight are in different years, and the label would drop the
 * year from a date that needs it or add one to a date that does not.
 */
export const dayLabel = (at: string, now: DateTime, locale: string, zone: string | null): string => {
  const day = zoned(at, zone).setLocale(locale);

  // One date is one word to a line: "läuft ab 21. Nov" broke between the day and its month.
  return day.toFormat(day.year === nowThere(now, zone).year ? DAY_IN_YEAR : DAY).replace(/ /g, '\u00a0');
};

/** The address handed out: the token's, for both kinds, because opening it is what the server counts. */
export const linkAddress = (link: ShareLink): string => appUrl(`/shared/${link.token}`);
