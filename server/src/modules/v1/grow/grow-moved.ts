import { Model } from 'mongoose';
import type { FollowedGrowCard } from '@fg2/shared-types/v1';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { diaryMovedAt } from '../diary/diary-entries';
import { spacesNow } from './grow-places';

/** When a grow last moved, and what moved it: what a public card dates it by and says beside the age. */
export interface Moved {
  at: Date;
  by: FollowedGrowCard['updatedBy'];
}

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
  models: { entries: Model<EntryDocument>; cameras: Model<CameraDocument>; devices: Model<StoredDevice> },
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
          .find({ spaceId: { $in: spaceIds }, removedAt: null }, { spaceId: 1, 'state.lastStillAt': 1 })
          .lean<Pick<CameraDocument, 'spaceId' | 'state'>[]>(),
    spaceIds.length === 0
      ? []
      : models.devices.find({ spaceId: { $in: spaceIds } }, { spaceId: 1, 'state.lastSeenAt': 1 }).lean<Pick<StoredDevice, 'spaceId' | 'state'>[]>(),
  ]);

  return new Map(
    grows.map(grow => {
      const here = standing.get(grow.id) ?? [];
      const line = lines.get(grow.id);
      const signs: Moved[] = [
        { at: grow.startedAt, by: 'start' },
        ...(line ? [{ at: line, by: 'entry' as const }] : []),
        ...(grow.publicCameras === false ? [] : cameras)
          .filter(camera => camera.spaceId !== null && here.includes(camera.spaceId))
          .flatMap(camera => (camera.state?.lastStillAt ? [{ at: camera.state.lastStillAt, by: 'picture' as const }] : [])),
        ...devices
          .filter(device => device.spaceId !== null && here.includes(device.spaceId))
          .flatMap(device => (device.state?.lastSeenAt ? [{ at: device.state.lastSeenAt, by: 'reading' as const }] : [])),
      ];

      return [grow.id, signs.reduce((newest, sign) => (sign.at.getTime() > newest.at.getTime() ? sign : newest))];
    }),
  );
};
