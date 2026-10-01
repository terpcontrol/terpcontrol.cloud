import type { AccountLayers, DiaryChoice, EntryKind } from '@fg2/shared-types/v1';
import { Model } from 'mongoose';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';

/**
 * Whether the app lays the grow diary over an account's climate.
 *
 * A grower with one device who has never written a line is shown the climate
 * and what is done with it, and the diary's invitations stay out of the way;
 * whoever has used the diary keeps it. What a person said wins over what they
 * did, in both directions, so a "no thanks" stays said on every device.
 *
 * It is worked out here rather than in a client so that every screen of every
 * device agrees, and from two reads that stop at their first match.
 */

/**
 * The lines that are keeping a diary: what a person writes about their plants.
 * A step-in is maintenance and a move needs a grow, and nothing a device, the
 * plan or an alarm writes counts, so a grower who only ever paused the
 * controller has kept no diary.
 */
export const DIARY_WRITTEN_KINDS: EntryKind[] = ['water', 'feed', 'photo', 'note', 'measurement', 'training', 'phase', 'harvest'];

export const layersOf = async (
  userId: string,
  choice: DiaryChoice | null | undefined,
  grows: Model<GrowDocument>,
  entries: Model<EntryDocument>,
): Promise<AccountLayers> => {
  if (choice === 'on' || choice === 'off') return { diary: choice === 'on' };

  return { diary: await keptDiary(userId, grows, entries) };
};

/** Any grow of theirs, ended or archived ones included, or any line they wrote themselves. */
const keptDiary = async (userId: string, grows: Model<GrowDocument>, entries: Model<EntryDocument>): Promise<boolean> =>
  (await grows.exists({ ownerId: userId })) !== null ||
  (await entries.exists({ authorId: userId, source: 'human', kind: { $in: DIARY_WRITTEN_KINDS } })) !== null;
