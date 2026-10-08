import { Model } from 'mongoose';
import { Grant } from '@common/v1/access.types';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { NOTHING_HIDDEN, Redaction, redactionOf } from './grow-serialiser';

/** What a grant comes to for the serialisers: the privacy of whoever owns the thing being read. */
export const grantRedaction = async (users: Model<StoredUser>, grant: Grant): Promise<Redaction> => {
  if (!grant.redacted) return NOTHING_HIDDEN;

  const owner = grant.privacyOwnerId ? await users.findOne({ id: grant.privacyOwnerId }, { privacy: 1 }).lean<Pick<StoredUser, 'privacy'>>() : null;
  return redactionOf(true, owner?.privacy);
};

/**
 * Whose privacy applies to each of several grows, by their owners; nothing is
 * hidden from a reader who is not redacted.
 *
 * It answers a function rather than a map because the miss matters: an owner
 * whose row could not be read - deleted, or deleted from under their grows -
 * hides everything, which is the only direction that is safe from somebody who
 * is already a stranger. A map with a fallback beside it is a fallback somebody
 * reads as "nothing to hide".
 */
export const ownerRedactions = async (
  users: Model<StoredUser>,
  redacted: boolean,
  ownerIds: Iterable<string>,
): Promise<(ownerId: string) => Redaction> => {
  if (!redacted) return () => NOTHING_HIDDEN;

  const owners = await users.find({ id: { $in: [...new Set(ownerIds)] } }, { id: 1, privacy: 1 }).lean<Pick<StoredUser, 'id' | 'privacy'>[]>();
  const privacy = new Map(owners.map(owner => [owner.id, owner.privacy]));

  return ownerId => redactionOf(true, privacy.get(ownerId));
};
