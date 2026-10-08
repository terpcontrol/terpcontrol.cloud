import { DateTime } from 'luxon';

/**
 * An instant on an account's own clock: in its zone, or in UTC where it names
 * none or one this host has never heard of, which would otherwise make every
 * reading of the clock unreadable.
 */
export const localOf = (at: Date, zone: string | null | undefined): DateTime => {
  const local = DateTime.fromJSDate(at, { zone: zone || 'UTC' });
  return local.isValid ? local : DateTime.fromJSDate(at, { zone: 'UTC' });
};
