import { Model } from 'mongoose';
import { AccessRange } from '@common/v1/access.types';
import { Span, picturesWithinRange } from '@common/v1/range';
import { MediaDocument } from '@database/schemas/v1/media.schema';

/**
 * The cameras' part of a diary: the picture of each day, and the week films.
 *
 * The camera's picture of a day: the still taken in the light nearest one
 * instant of it - midday for a day that is over, so the days read as one
 * picture a day rather than as whatever the camera last sent.
 *
 * A day whose instant the cameras missed can still be one they covered for
 * hours - a lamp on a night schedule, a camera plugged in in the evening - so
 * such a day takes the lit still nearest that instant from anywhere inside
 * it, and only a day the camera never saw lit is shown by a dark one - once
 * it is over.
 */

/**
 * How far from its instant a still may be taken and still stand for the day
 * without a second look. Wide enough that a camera taking one picture an hour
 * answers, narrow enough that reading a week of days is not reading a week of
 * pictures - stills are thinned as they age, so an older day answers a handful
 * of rows and only the newest answers many.
 */
const STILL_WINDOW_MS = 90 * 60 * 1000;

/** A day to find the picture of. `key` is whatever the caller tells its days apart by. */
export interface PicturedDay {
  key: number;
  startsAt: Date;
  endsAt: Date;
  /** The instant the picture is taken nearest. */
  nearest: Date;
  /**
   * Whether a picture taken in the dark may stand for the day where it was
   * never seen lit. Not for a day still running: its lamp may yet come on, and
   * until then a black frame says less than no picture.
   */
  darkToo?: boolean;
}

export type DayStill = Pick<MediaDocument, 'id' | 'cameraId' | 'capturedAt'>;

const PROJECTION = { id: 1, cameraId: 1, capturedAt: 1 };

/**
 * The still of each day, by the day's key. One read for the pictures around
 * every day's instant, then two indexed reads per day that had none there.
 * `seen` bounds every read, so a picture is never one taken outside what the
 * reader may see.
 */
export const stillsOfDays = async (
  media: Model<MediaDocument>,
  cameraIds: readonly string[],
  days: readonly PicturedDay[],
  seen: Span,
): Promise<Map<number, DayStill>> => {
  if (cameraIds.length === 0 || days.length === 0) return new Map();

  const around = await media
    .find(
      {
        $and: [
          { cameraId: { $in: cameraIds }, kind: 'still', lit: { $ne: false } },
          { capturedAt: { $gte: seen.startsAt, $lte: seen.endsAt } },
          {
            $or: days.map(day => ({
              capturedAt: { $gte: new Date(day.nearest.getTime() - STILL_WINDOW_MS), $lte: new Date(day.nearest.getTime() + STILL_WINDOW_MS) },
            })),
          },
        ],
      },
      PROJECTION,
    )
    .lean<DayStill[]>();

  const found = await Promise.all(
    days.map(async day => {
      const still =
        nearestTo(around, day) ??
        (await nearestInDay(media, cameraIds, day, seen, true)) ??
        (day.darkToo === false ? null : await nearestInDay(media, cameraIds, day, seen, false));
      return still ? ([[day.key, still]] as const) : [];
    }),
  );

  return new Map(found.flat());
};

/** The still nearest the day's instant among those read around it: inside the day, and no further off than the window. */
const nearestTo = (rows: readonly DayStill[], day: PicturedDay): DayStill | null =>
  rows.reduce<DayStill | null>((best, row) => {
    const distance = Math.abs(row.capturedAt.getTime() - day.nearest.getTime());
    if (distance > STILL_WINDOW_MS || row.capturedAt < day.startsAt || row.capturedAt >= day.endsAt) return best;

    return best === null || distance < Math.abs(best.capturedAt.getTime() - day.nearest.getTime()) ? row : best;
  }, null);

/** The still nearest the day's instant from anywhere inside the day and the window, or nothing where the day holds none. */
const nearestInDay = async (
  media: Model<MediaDocument>,
  cameraIds: readonly string[],
  day: PicturedDay,
  seen: Span,
  lit: boolean,
): Promise<DayStill | null> => {
  const from = day.startsAt > seen.startsAt ? day.startsAt : seen.startsAt;
  const until = day.endsAt < seen.endsAt ? day.endsAt : seen.endsAt;
  // The instant can lie past the window's end - a window that closes at
  // midnight on a day that runs to the next afternoon - so the look back from
  // it stops where the window does, like the look forward.
  const upTo = day.nearest < until ? day.nearest : until;
  const light = lit ? { lit: { $ne: false } } : {};
  const [before, after] = await Promise.all([
    media
      .findOne({ cameraId: { $in: cameraIds }, kind: 'still', ...light, capturedAt: { $gte: from, $lte: upTo } }, PROJECTION)
      .sort({ capturedAt: -1 })
      .lean<DayStill>(),
    media
      .findOne({ cameraId: { $in: cameraIds }, kind: 'still', ...light, capturedAt: { $gt: day.nearest, $gte: from, $lt: until } }, PROJECTION)
      .sort({ capturedAt: 1 })
      .lean<DayStill>(),
  ]);
  if (!before || !after) return before ?? after ?? null;

  const distance = (row: DayStill) => Math.abs(row.capturedAt.getTime() - day.nearest.getTime());
  return distance(before) <= distance(after) ? before : after;
};

export type WeekFilm = Pick<MediaDocument, 'id' | 'capturedAt' | 'endsAt' | 'lengthSeconds'>;

/**
 * The week films the timelapse builder has already made that reach into a
 * span, so a week points at one rather than asking for it to be built. Only a
 * film that ends inside the reader's window is one: the media route refuses
 * the rest, and a week naming it would be pointing at days nobody sent.
 */
export const weekFilmsOf = (media: Model<MediaDocument>, cameraIds: readonly string[], span: Span, range: AccessRange): Promise<WeekFilm[]> => {
  if (cameraIds.length === 0) return Promise.resolve([]);
  const held = picturesWithinRange(range);

  return media
    .find(
      {
        cameraId: { $in: cameraIds },
        kind: 'timelapse',
        window: 'week',
        capturedAt: { $lt: span.endsAt },
        $and: [{ $or: [{ endsAt: { $gt: span.startsAt } }, { endsAt: null, capturedAt: { $gte: span.startsAt } }] }, ...held],
      },
      { id: 1, capturedAt: 1, endsAt: 1, lengthSeconds: 1 },
    )
    .lean<WeekFilm[]>();
};
