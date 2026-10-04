import { DateTime } from 'luxon';
import { calendarDay } from '@/ui/zone';
import type { Camera } from '@fg2/shared-types/v1';

/**
 * What a camera's entitlement means for a screen, worked out in one place.
 *
 * The server says whether a camera is entitled (`tier`), why it was given its
 * year (`grant`), until when (`validUntil`) and whether a renewal may be
 * offered at all (`renewalVisible`: something is gated here and there is
 * somewhere to send the person). Nothing here decides any of those again - a
 * date still ahead is not entitlement, and a date is never read where the
 * server has not allowed a notice.
 *
 * What the server does not carry is the board's rule that the renewal is shown
 * sixty days before the year ends and not earlier. That window is applied
 * here, inside the permission the server gives, which is why a camera whose
 * renewal is not visible never gets a countdown however close its date is.
 */
export const RENEWAL_NOTICE_DAYS = 60;

/** Whole days until the entitlement ends; negative once it has; null where there is no date at all. */
export const daysLeft = (validUntil: string | null, now: DateTime): number | null =>
  validUntil === null ? null : Math.floor(DateTime.fromISO(validUntil).diff(now, 'days').days);

/**
 * Whether the renewal is to be offered for this camera: the server allows a
 * notice, and the camera is either without Premium or inside the last sixty
 * days of it. A camera without Premium is due now, not in sixty days.
 */
export const renewalDue = (camera: Pick<Camera, 'entitlement'>, now: DateTime): boolean => {
  const { renewalVisible, tier, validUntil } = camera.entitlement;
  if (!renewalVisible) return false;
  if (tier === 'free') return true;

  const left = daysLeft(validUntil, now);
  return left !== null && left <= RENEWAL_NOTICE_DAYS;
};

/**
 * The days a countdown says, or null where none is drawn: the renewal is not
 * due yet, the year is already over - which the camera's line says in words -
 * or no notice is allowed on this install.
 */
export const countdownDays = (camera: Pick<Camera, 'entitlement'>, now: DateTime): number | null => {
  if (camera.entitlement.tier !== 'premium' || !renewalDue(camera, now)) return null;

  const left = daysLeft(camera.entitlement.validUntil, now);
  return left !== null && left >= 0 ? left : null;
};

/**
 * A day as the board writes one beside a camera: "14 Oct 2027", read where the
 * account is - a year that runs out at midnight runs out on a different date
 * to a reader in another zone, and this is the date somebody pays against.
 */
export const dayLabel = (instant: string, zone: string | null): string => calendarDay(instant, zone);
