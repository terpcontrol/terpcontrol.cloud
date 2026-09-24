import { DateTime } from 'luxon';
import type { MediaWindow } from '@fg2/shared-types/v1';

/**
 * The day, the week and the month a rolling film covers, cut on the calendar
 * of the account that owns the camera.
 *
 * They used to be cut off the epoch: a day was a UTC day whatever the account's
 * zone, a week began on a Thursday because 1 January 1970 was one, and a month
 * was a block of thirty days that happened to start on 4 September this year.
 * A film called "Week" then ran Thursday to Thursday, "Today" ran from two in
 * the morning for a Berlin grower, and the weekly push arrived on a Thursday
 * about a week nobody would recognise. Here a day starts at the account's
 * midnight, a week on its Monday, and a month on the first.
 */

export type RollingWindow = Extract<MediaWindow, 'day' | 'week' | 'month'>;

export const ROLLING_WINDOWS: RollingWindow[] = ['day', 'week', 'month'];

export const isRolling = (window: MediaWindow): window is RollingWindow => (ROLLING_WINDOWS as MediaWindow[]).includes(window);

export interface Period {
  startsAt: Date;
  endsAt: Date;
}

/** The zone a period is cut in: the account's, or UTC where it names none or one Luxon does not know. */
const localOf = (at: Date, zone: string | null | undefined): DateTime => {
  const local = DateTime.fromJSDate(at, { zone: zone || 'UTC' });
  return local.isValid ? local : DateTime.fromJSDate(at, { zone: 'UTC' });
};

/** The period of this window that holds the instant. */
export const periodAround = (window: RollingWindow, at: Date, zone: string | null | undefined): Period => {
  const startsAt = localOf(at, zone).startOf(window);
  return { startsAt: startsAt.toJSDate(), endsAt: startsAt.plus({ [`${window}s`]: 1 }).toJSDate() };
};

/** The period just before this one. */
export const periodBefore = (window: RollingWindow, period: Period, zone: string | null | undefined): Period =>
  periodAround(window, new Date(period.startsAt.getTime() - 1), zone);
