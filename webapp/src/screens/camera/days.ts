import type { Camera, GrowDiaryPage, GrowListItem } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf } from '@fg2/shared-types/v1-schemas/feeding.js';

/**
 * The days the slider under the picture walks: one picture per day of the
 * grow the camera watches, the one the diary heads that day's card with - the
 * still taken in the light nearest midday. Which still that is, is the
 * server's answer (`GET /v1/grows/{id}/diary`); nothing here picks a picture.
 */

/** One day of the grow as this camera pictured it. */
interface PicturedDay {
  dayNumber: number;
  mediaId: string;
  capturedAt: string;
}

/** The days this camera has a picture of in the pages of the diary read so far, oldest first. */
export const picturedDays = (pages: readonly GrowDiaryPage[] | undefined, cameraId: string): PicturedDay[] =>
  (pages ?? [])
    .flatMap(page => page.items)
    .flatMap(week => week.days)
    .flatMap(day =>
      day.still && day.still.cameraId === cameraId
        ? [{ dayNumber: day.dayNumber, mediaId: day.still.mediaId, capturedAt: day.still.capturedAt }]
        : [],
    )
    .sort((one, other) => one.dayNumber - other.dayNumber);

/** The first day of the grow this camera can have pictured: the day it was added on, or the grow's first. */
export const firstDayOf = (camera: Pick<Camera, 'createdAt'>, grow: Pick<GrowListItem, 'startedAt' | 'phases' | 'summary'>): number =>
  growDayAt(growOriginOf(grow), camera.createdAt, grow.summary.zone);

/**
 * The day a move of the slider lands on. The handle rests only on days that
 * have a picture: a step with the keys goes to the next such day in its
 * direction, and a drag to the one nearest to where it was let go, on the
 * side it was dragged to - of two as near, the one it passed last. Where
 * that side has none it stays.
 */
export const landsOn = (days: readonly number[], from: number, to: number): number => {
  const side = days.filter(day => (to < from ? day < from : day > from));
  const off = (day: number) => Math.abs(day - to) * days.length * 2 + Math.abs(day - from);
  return side.reduce((best, day) => (off(day) < off(best) ? day : best), side[0] ?? from);
};

/** The pictured day nearest to one the slider was left on, for a day that turns out to have no picture. */
export const nearestTo = (days: readonly number[], day: number): number | null =>
  days.length > 0 ? days.reduce((best, one) => (Math.abs(one - day) <= Math.abs(best - day) ? one : best)) : null;
