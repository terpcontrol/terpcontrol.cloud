import { DateTime } from 'luxon';
import type { Camera } from '@fg2/shared-types/v1';

/**
 * What a camera's entitlement means for a screen, worked out in one place.
 *
 * The server says whether a camera is entitled (`tier`), why it was given its
 * year (`grant`), until when (`validUntil`) and whether a renewal is to be
 * offered now (`renewalVisible`: something is gated here, there is somewhere to
 * send the person, and the year is inside its last `RENEWAL_WINDOW_DAYS` or
 * there never was one). Nothing here decides any of those again - a date still
 * ahead is not entitlement, and a date is never read where the server has not
 * allowed a notice, however close it is.
 */

/** Whole days until the entitlement ends; negative once it has; null where there is no date at all. */
const daysLeft = (validUntil: string | null, now: DateTime): number | null =>
  validUntil === null ? null : Math.floor(DateTime.fromISO(validUntil).diff(now, 'days').days);

/**
 * The days a countdown says, or null where none is drawn: the renewal is not
 * due yet, the year is already over - which the camera's line says in words -
 * or no notice is allowed on this install.
 */
export const countdownDays = (camera: Pick<Camera, 'entitlement'>, now: DateTime): number | null => {
  if (camera.entitlement.tier !== 'premium' || !camera.entitlement.renewalVisible) return null;

  const left = daysLeft(camera.entitlement.validUntil, now);
  return left !== null && left >= 0 ? left : null;
};
