import { DateTime } from 'luxon';
import type { Me } from '@fg2/shared-types/v1';

/**
 * The zone a clock time is drawn in.
 *
 * The account carries one - an IANA name in `preferences.timezone` - and the
 * server means it: quiet hours are read in that zone, so an alarm held back
 * until seven is held back until seven there and nowhere else. A time drawn in
 * the browser's zone instead is therefore not the same time as the one the
 * account was set by, and the two disagree by however far the reader is from
 * their own zone - which is the whole of somebody setting a window by the
 * numbers in front of them and getting a different window.
 *
 * So every clock time the app draws for its owner goes through here. It is
 * deliberately not about ages: how long ago something was is the same length
 * of time in every zone, and `age.ts` keeps saying it.
 */

/** The account's zone, or null while nothing has answered yet - which leaves Luxon on the browser's. */
export const zoneOf = (me: Me | undefined): string | null => me?.preferences.timezone || null;

/** An instant to read in the account's zone. */
export const zoned = (instant: string, zone: string | null): DateTime => {
  const at = DateTime.fromISO(instant);

  return zone ? at.setZone(zone) : at;
};

/** The zone this browser is in, which is what an account that has never said gets offered. */
export const browserZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Every zone this browser knows, for the menu that sets the account's. The list
 * is the platform's rather than one kept here, because a zone is a fact about
 * the world that changes without this app: a browser too old to answer leaves
 * the menu with what the account already holds and what this device is in,
 * which is enough to correct an account that was migrated onto UTC.
 */
export const zoneNames = (): string[] => {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;

  try {
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
};
