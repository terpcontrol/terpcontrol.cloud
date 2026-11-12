import { Model } from 'mongoose';
import { StoredUser } from '@database/schemas/v1/users.schema';

/**
 * The zone a grow's days are dates of: its owner's, whoever reads. Null for an
 * owner who is gone, which counts as UTC like an account nobody set a zone on.
 */
export const zoneOfOwner = async (users: Model<StoredUser>, ownerId: string): Promise<string | null> =>
  (await zonesOfOwners(users, [ownerId]))(ownerId);

/** The same for the owners of a page of grows, in one read. */
export const zonesOfOwners = async (users: Model<StoredUser>, ownerIds: readonly string[]): Promise<(ownerId: string) => string | null> => {
  const ids = [...new Set(ownerIds)];
  const owners =
    ids.length > 0
      ? await users.find({ id: { $in: ids } }, { id: 1, 'preferences.timezone': 1 }).lean<Pick<StoredUser, 'id' | 'preferences'>[]>()
      : [];
  const zones = new Map(owners.map(owner => [owner.id, owner.preferences?.timezone || null]));

  return ownerId => zones.get(ownerId) ?? null;
};
