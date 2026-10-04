import { Schema } from 'mongoose';
import { memberRole } from '@fg2/shared-types/v1-schemas';
import type { Membership } from '@fg2/shared-types/v1';

/**
 * One row per person who is not the owner. The owner is `spaces.ownerId` and
 * never a row here, so a space with no members holds no membership at all.
 */
export type MembershipDocument = Omit<Membership, 'createdAt'> & { createdAt: Date };

export const membershipsSchema = new Schema<MembershipDocument>(
  {
    id: { type: String, required: true, unique: true },
    spaceId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: memberRole.options, required: true },
    invitedBy: { type: String, default: null },
    inviteId: { type: String, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'memberships', versionKey: false },
);

// A person is a member of a space once. This also serves the member list of a
// space and the lookup a redemption does before it adds a row.
membershipsSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

// `access()` asks on every request which spaces the caller is a member of.
membershipsSchema.index({ userId: 1 });
