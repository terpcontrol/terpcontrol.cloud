import { FilterQuery, Model } from 'mongoose';
import { withSpacesInside } from '@common/v1/rooms';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';

/**
 * The grows a person may see, as one filter: their own, and those standing in
 * a space they are a member of. It is the grow list's rule and the diary
 * layer's, kept in one place so that the account whose Start offers the diary
 * and the account "Meine Grows" lists grows for are worked out the same way.
 */
export const growsVisibleTo = async (
  userId: string,
  memberships: Model<MembershipDocument>,
  spaces: Model<SpaceDocument>,
): Promise<FilterQuery<GrowDocument>> => {
  const rows = await memberships.find({ userId }, { spaceId: 1 }).lean();
  const held = rows.map(row => row.spaceId);
  if (held.length === 0) return { ownerId: userId };

  return { $or: [{ ownerId: userId }, { 'placements.spaceId': { $in: await withSpacesInside(spaces, held) } }] };
};
