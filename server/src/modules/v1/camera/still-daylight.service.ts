import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CAMERA_STILLS } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CameraDaylight } from '@modules/data/camera-daylight.port';
import { thinnedSpacingAt } from './still-thinning';

/** A camera as far as its stills' word on the day goes: how often it promises one. */
type Witness = Pick<CameraDocument, 'id' | 'stillIntervalSeconds'>;

/** A still whose colour was measured when it was stored (`monochromeOf`). */
export interface SeenStill {
  cameraId: string;
  /** Epoch milliseconds. */
  at: number;
  monochrome: boolean;
}

/**
 * How long after it was taken a still still says which half its camera sees:
 * for as long as the camera counts as delivering - ten of its own intervals,
 * five minutes at the usual thirty seconds, after which every screen calls it
 * stopped (`CAMERA_STILLS`) - and, over the past, for the gap thinning has left
 * after it by then, a minute to an hour.
 *
 * Not one interval: a capture fails now and then and the next comes a retry
 * later, and the half must not flip to the night for every still that went
 * missing. Nor longer: a camera that has stopped says nothing about a lamp
 * that went out after it did. And without the thinned gap a chart of last
 * month would read most of its windows as nights again, because one still in
 * five or fifteen minutes is all that is kept of them.
 */
export const stillSpeaksForMs = (camera: Pick<Witness, 'stillIntervalSeconds'>, ageMs: number): number =>
  CAMERA_STILLS.offlineAfter * camera.stillIntervalSeconds * 1000 + thinnedSpacingAt(ageMs);

/** The latest of stills in order that was taken at or before an instant. */
const lastAtOrBefore = (stills: readonly SeenStill[], at: number): SeenStill | null => {
  let low = 0;
  let high = stills.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (stills[middle].at <= at) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? stills[low - 1] : null;
};

/**
 * What a place's stills say of an instant: the newest still of any of its
 * cameras taken at or before it, as long as it still speaks for its camera
 * (`stillSpeaksForMs`) - day where it is in colour, night where it is grey -
 * and null where no camera has a word for it.
 */
export const daylightOf = (stills: readonly SeenStill[], cameras: readonly Witness[], now: number): ((at: number) => boolean | null) => {
  const lanes = cameras.map(camera => ({
    camera,
    stills: stills.filter(still => still.cameraId === camera.id).sort((one, other) => one.at - other.at),
  }));

  return at => {
    let newest: SeenStill | null = null;
    for (const lane of lanes) {
      const still = lastAtOrBefore(lane.stills, at);
      if (still && at - still.at <= stillSpeaksForMs(lane.camera, now - still.at) && (!newest || still.at > newest.at)) newest = still;
    }
    return newest ? !newest.monochrome : null;
  };
};

/**
 * Which half of the day the cameras of a place saw, from the colour of their
 * stills: a camera switches to its night mode, and sends grey, once the tent
 * goes dark. It is what a smart plug that keeps no schedule goes by for its
 * VPD (ADR 0006), so a chart of a plug pays for it with the series it reads.
 *
 * Two reads, whatever the window: the cameras standing in the space - removed
 * ones too, whose stills are the place's past - and their stills, gathered by
 * the store into the newest of every half step. Half a step, because a window
 * of a series takes the half at its middle (`DataService`), and the windows
 * are cut on the step from the epoch, so every middle is where one of these
 * groups ends and its newest still is the newest before the middle. A still
 * from before its colour was measured says nothing.
 */
@Injectable()
export class StillDaylightService implements CameraDaylight {
  constructor(
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
  ) {}

  public async dayIn(spaceId: string, window: { startsAt: Date; endsAt: Date; stepSeconds: number }): Promise<(at: number) => boolean | null> {
    const cameras = await this.cameras.find({ spaceId }, { _id: 0, id: 1, stillIntervalSeconds: 1 }).lean<Witness[]>();
    if (cameras.length === 0) return () => null;

    const now = Date.now();
    const halfStep = Math.max(1, window.stepSeconds) * 500;
    const first = window.startsAt.getTime() - halfStep;
    // Far enough back for any still that may speak for the first instant: how
    // long one does grows with its age, by the coarsest gap thinning leaves at most.
    const reach = Math.max(...cameras.map(camera => stillSpeaksForMs(camera, now - first + stillSpeaksForMs(camera, Infinity))));

    const groups = await this.media.aggregate<{ _id: { cameraId: string }; newest: { at: Date; monochrome: boolean } }>([
      {
        $match: {
          cameraId: { $in: cameras.map(camera => camera.id) },
          kind: 'still',
          capturedAt: { $gte: new Date(first - reach), $lte: window.endsAt },
          monochrome: { $in: [true, false] },
        },
      },
      {
        $group: {
          _id: { cameraId: '$cameraId', slot: { $floor: { $divide: [{ $toLong: '$capturedAt' }, halfStep] } } },
          // Documents compare field by field, so this is the newest of the group and its colour.
          newest: { $max: { at: '$capturedAt', monochrome: '$monochrome' } },
        },
      },
    ]);

    const stills = groups.map(group => ({ cameraId: group._id.cameraId, at: group.newest.at.getTime(), monochrome: group.newest.monochrome }));
    return daylightOf(stills, cameras, now);
  }
}
