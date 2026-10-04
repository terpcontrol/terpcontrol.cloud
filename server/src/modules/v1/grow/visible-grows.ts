import { FilterQuery, Model } from 'mongoose';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';

/**
 * The grows a person may see, as one filter: their own, and those standing in
 * a space they are a member of. It is the grow list's rule and the diary
 * layer's, kept in one place so that the account whose Start offers the diary
 * and the account "Meine Grows" lists grows for are worked out the same way.
 *
 * A membership on a room covers the spaces standing in it, so the rooms are
 * widened to what is inside them before a grow is looked for by its placements
 * - which is the rule `access()` decides one grow by, from the other end.
 */
export const growsVisibleTo = async (
  userId: string,
  memberships: Model<MembershipDocument>,
  spaces: Model<SpaceDocument>,
): Promise<FilterQuery<GrowDocument>> => {
  const rows = await memberships.find({ userId }, { spaceId: 1 }).lean();
  const held = rows.map(row => row.spaceId);
  if (held.length === 0) return { ownerId: userId };

  const inside = await spaces.find({ roomId: { $in: held } }, { id: 1 }).lean();
  const spaceIds = [...new Set([...held, ...inside.map(space => space.id)])];

  return { $or: [{ ownerId: userId }, { 'placements.spaceId': { $in: spaceIds } }] };
};
