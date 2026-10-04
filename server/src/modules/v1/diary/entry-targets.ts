import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, SubjectRef } from '@common/v1/access.types';
import { badRequest } from '@common/v1/problem';

/**
 * What an entry is about, and who may therefore write it.
 *
 * An entry names a grow, a space, a device, plants and pictures, and every one
 * of those is somebody's. The decision is made about **each** of them rather
 * than about one chosen as the primary: a person who may log in their own tent
 * must not be able to hang a line on somebody else's grow by naming both, and
 * that is exactly what picking one subject and checking only that would allow.
 *
 * `log` is what writing takes, which is the owner, a member of the space, or a
 * manager. A share link never carries `log` at all, so a stranger holding one
 * reads the diary and cannot add to it.
 */

/** The references on an entry that are somebody's, in the order a refusal names them. */
export interface EntryTargets {
  growId?: string | null;
  spaceId?: string | null;
  deviceId?: string | null;
  cameraId?: string | null;
  plantIds?: string[] | null;
  mediaIds?: string[] | null;
}

const subjectsOf = (targets: EntryTargets): SubjectRef[] => [
  ...(targets.growId ? [subjectRef('grow', targets.growId)] : []),
  ...(targets.spaceId ? [subjectRef('space', targets.spaceId)] : []),
  ...(targets.deviceId ? [subjectRef('device', targets.deviceId)] : []),
  ...(targets.cameraId ? [subjectRef('camera', targets.cameraId)] : []),
  ...(targets.plantIds ?? []).map(id => subjectRef('plant', id)),
  ...(targets.mediaIds ?? []).map(id => subjectRef('media', id)),
];

/**
 * Every subject the entry names, each demanded in turn. A subject that does not
 * exist and one the caller may not write to are the same refusal, which is
 * `AccessService.require`'s own rule: a stranger learns nothing about what is
 * there from the difference.
 */
export const requireLogOn = async (access: AccessService, ctx: AccessContext, targets: EntryTargets): Promise<void> => {
  const subjects = subjectsOf(targets);

  if (subjects.length === 0) {
    throw badRequest('entry_about_nothing', 'An entry is about a grow, a space, a device or plants.', [
      { field: 'growId', code: 'required', detail: 'Name at least one of growId, spaceId, deviceId or plantIds.' },
    ]);
  }

  // In turn rather than at once: each is a handful of lookups, and the first
  // refusal is the one worth telling the caller about.
  for (const subject of subjects) await access.require(ctx, subject, 'log');
};
