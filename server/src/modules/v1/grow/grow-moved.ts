import { Model } from 'mongoose';
import type { FollowedGrowCard } from '@fg2/shared-types/v1';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { diaryMovedAt } from '../diary/diary-entries';
import { spacesNow } from './grow-places';

/**
 * When a grow last moved, and what moved it: what a public card dates it by and says beside the age - and the newest
 * picture a camera took in the light where it stands, which the card is drawn over where the grow has no cover.
 */
export interface Moved {
  at: Date;
  by: FollowedGrowCard['updatedBy'];
  picture: string | null;
}

/**
 * The grow as its public card draws it: under its own cover, else under the newest picture of a camera where it
 * stands. A card that said "Bild vor 3 Std" beside a leaf had a picture three hours old and drew none.
 */
export const coveredBy = (grow: GrowDocument, moved: Moved): GrowDocument =>
  grow.coverMediaId || !moved.picture ? grow : { ...grow, coverMediaId: moved.picture };

/**
 * When each of these grows last showed a sign of life to somebody reading its
 * public page: the newest picture of a camera where it stands - where its page
 * shows the cameras -, the newest word from a device there, the newest line of
 * its diary, and failing all of them the day it started. A grow that is over
 * stands nowhere, so only its diary and its start date it.
 *
 * The row's own write time is none of these: a grow whose camera took a
 * picture a minute ago and whose diary nobody wrote in read "20 days ago", the
 * day it was started.
 */
export const growsMoved = async (
  grows: GrowDocument[],
  models: { entries: Model<EntryDocument>; cameras: Model<CameraDocument>; devices: Model<StoredDevice>; media: Model<MediaDocument> },
): Promise<Map<string, Moved>> => {
  const standing = new Map(grows.map(grow => [grow.id, grow.endedAt === null ? spacesNow(grow) : []]));
  const spaceIds = [...new Set([...standing.values()].flat())];
  const [lines, cameras, devices] = await Promise.all([
    diaryMovedAt(
      models.entries,
      grows.map(grow => grow.id),
    ),
    spaceIds.length === 0
      ? []
      : models.cameras
          .find({ spaceId: { $in: spaceIds }, removedAt: null }, { id: 1, spaceId: 1, 'state.lastStillAt': 1 })
          .lean<Pick<CameraDocument, 'id' | 'spaceId' | 'state'>[]>(),
    spaceIds.length === 0
      ? []
      : models.devices.find({ spaceId: { $in: spaceIds } }, { spaceId: 1, 'state.lastSeenAt': 1 }).lean<Pick<StoredDevice, 'spaceId' | 'state'>[]>(),
  ]);

  // The cameras each grow's page shows, from when it came to stand in front of them: a still from before is another
  // grow's, and its public page would not hand it out.
  const shown = new Map(
    grows.map(grow => {
      const here = standing.get(grow.id) ?? [];
      const looking = (grow.publicCameras === false ? [] : cameras).filter(camera => camera.spaceId !== null && here.includes(camera.spaceId));
      return [grow.id, looking] as const;
    }),
  );
  const pictures = new Map(
    await Promise.all(grows.map(async grow => [grow.id, await newestLitStill(models.media, grow, shown.get(grow.id) ?? [])] as const)),
  );

  return new Map(
    grows.map(grow => {
      const here = standing.get(grow.id) ?? [];
      const line = lines.get(grow.id);
      const picture = pictures.get(grow.id) ?? null;
      const signs: Omit<Moved, 'picture'>[] = [
        { at: grow.startedAt, by: 'start' },
        ...(line ? [{ at: line, by: 'entry' as const }] : []),
        ...(shown.get(grow.id) ?? []).flatMap(camera =>
          camera.state?.lastStillAt ? [{ at: camera.state.lastStillAt, by: 'picture' as const }] : [],
        ),
        ...devices
          .filter(device => device.spaceId !== null && here.includes(device.spaceId))
          .flatMap(device => (device.state?.lastSeenAt ? [{ at: device.state.lastSeenAt, by: 'reading' as const }] : [])),
      ];

      return [grow.id, { ...signs.reduce((newest, sign) => (sign.at.getTime() > newest.at.getTime() ? sign : newest)), picture }];
    }),
  );
};

/** The newest still taken in the light by these cameras since the grow came to stand in front of each. */
const newestLitStill = async (
  media: Model<MediaDocument>,
  grow: GrowDocument,
  cameras: Pick<CameraDocument, 'id' | 'spaceId'>[],
): Promise<string | null> => {
  const since = cameras.flatMap(camera => {
    const placement = grow.placements.find(one => one.endedAt === null && one.spaceId === camera.spaceId);
    return placement ? [{ cameraId: camera.id, capturedAt: { $gte: placement.startedAt } }] : [];
  });
  if (since.length === 0) return null;

  const still = await media
    .findOne({ $and: [{ kind: 'still', lit: { $ne: false } }, { $or: since }] }, { id: 1 })
    .sort({ capturedAt: -1 })
    .lean<Pick<MediaDocument, 'id'>>();
  return still?.id ?? null;
};
