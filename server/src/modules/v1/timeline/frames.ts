import { Model } from 'mongoose';
import type { TimelineCamera } from '@fg2/shared-types/v1';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';

/**
 * How many stills the charts page steps through per camera, whatever the
 * window: twice the Timeline's, because the cursor there moves across a whole
 * screen's width of curve rather than a strip.
 */
export const CHART_FRAME_SLOTS = 240;

/**
 * The frames a cursor steps through: at most one per slot, per camera, and all
 * of them in one aggregation. The slot a picture falls in is grouped in the
 * database, because the alternative is reading a day of stills out to keep a
 * hundred of them. The Timeline and the charts page both draw the picture at
 * their cursor from this.
 *
 * The one a slot answers with is its newest, which is the picture the app
 * promises: the rail draws the newest still taken by the cursor, and the cursor
 * at rest sits at the end of the window. Taking the oldest of each slot instead
 * left the last one - the slot the camera is still filling - answering with a
 * picture up to a whole slot old, so the tent's rail and the same tent's
 * overview strip named two different newest pictures, twelve minutes apart over
 * a day and eighty-four over a week. Every frame still carries the instant of
 * the picture it actually is, so nothing is dated by its slot.
 */
export const framesOf = async (
  media: Model<MediaDocument>,
  cameras: readonly Pick<CameraDocument, 'id'>[],
  window: { startsAt: Date; endsAt: Date },
  slots: number,
): Promise<Map<string, TimelineCamera['frames']>> => {
  if (cameras.length === 0 || window.endsAt <= window.startsAt) return new Map();

  const slotMs = Math.max(1, Math.floor((window.endsAt.getTime() - window.startsAt.getTime()) / slots));
  const rows = await media.aggregate<{ _id: { cameraId: string }; mediaId: string; capturedAt: Date }>([
    {
      $match: {
        cameraId: { $in: cameras.map(camera => camera.id) },
        kind: 'still',
        capturedAt: { $gte: window.startsAt, $lte: window.endsAt },
      },
    },
    { $sort: { capturedAt: 1 } },
    {
      $group: {
        _id: { cameraId: '$cameraId', slot: { $floor: { $divide: [{ $subtract: ['$capturedAt', window.startsAt] }, slotMs] } } },
        mediaId: { $last: '$id' },
        capturedAt: { $last: '$capturedAt' },
      },
    },
    { $sort: { capturedAt: 1 } },
  ]);

  const frames = new Map<string, TimelineCamera['frames']>();
  for (const row of rows) {
    const own = frames.get(row._id.cameraId) ?? [];
    frames.set(row._id.cameraId, [...own, { mediaId: row.mediaId, capturedAt: row.capturedAt.toISOString() }]);
  }

  return frames;
};
