import type { AccountLayers, DiaryChoice, EntryKind } from '@fg2/shared-types/v1';
import { Model } from 'mongoose';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { growsVisibleTo } from '../grow/visible-grows';

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
const DIARY_WRITTEN_KINDS: EntryKind[] = ['water', 'feed', 'photo', 'note', 'measurement', 'training', 'phase', 'harvest'];

/** What the answer is read from. */
interface DiaryReads {
  grows: Model<GrowDocument>;
  entries: Model<EntryDocument>;
  memberships: Model<MembershipDocument>;
  spaces: Model<SpaceDocument>;
}

export const layersOf = async (userId: string, choice: DiaryChoice | null | undefined, reads: DiaryReads): Promise<AccountLayers> => {
  if (choice === 'on' || choice === 'off') return { diary: choice === 'on' };

  return { diary: await keptDiary(userId, reads) };
};

/**
 * Any grow they can see, ended or archived ones included, or any line they
 * wrote themselves. A grow somebody runs in a tent the account was let into
 * counts as one of its own: that grow is why the account was invited, and
 * without it a guest who may write into its diary was shown the tent's
 * climate with neither the grow, nor the way to every grow, nor the button
 * that writes a line.
 */
const keptDiary = async (userId: string, { grows, entries, memberships, spaces }: DiaryReads): Promise<boolean> =>
  (await grows.exists(await growsVisibleTo(userId, memberships, spaces))) !== null ||
  (await entries.exists({ authorId: userId, source: 'human', kind: { $in: DIARY_WRITTEN_KINDS } })) !== null;
