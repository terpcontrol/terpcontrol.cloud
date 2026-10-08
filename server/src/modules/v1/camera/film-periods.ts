import type { MediaWindow } from '@fg2/shared-types/v1';
import { localOf } from '@common/v1/local-time';
import { Span } from '@common/v1/range';

/**
 * The day, the week and the month a rolling film covers, cut on the calendar
 * of the account that owns the camera: a day starts at the account's midnight,
 * a week on its Monday, and a month on the first. Cut off the epoch instead, a
 * week would begin on a Thursday - 1 January 1970 was one - and "Today" would
 * run from two in the morning for a Berlin grower.
 */

export type RollingWindow = Extract<MediaWindow, 'day' | 'week' | 'month'>;

const ROLLING_WINDOWS: RollingWindow[] = ['day', 'week', 'month'];

export const isRolling = (window: MediaWindow): window is RollingWindow => (ROLLING_WINDOWS as MediaWindow[]).includes(window);

/** The period of this window that holds the instant. */
export const periodAround = (window: RollingWindow, at: Date, zone: string | null | undefined): Span => {
  const startsAt = localOf(at, zone).startOf(window);
  return { startsAt: startsAt.toJSDate(), endsAt: startsAt.plus({ [`${window}s`]: 1 }).toJSDate() };
};

/** The period just before this one. */
export const periodBefore = (window: RollingWindow, period: Span, zone: string | null | undefined): Span =>
  periodAround(window, new Date(period.startsAt.getTime() - 1), zone);
