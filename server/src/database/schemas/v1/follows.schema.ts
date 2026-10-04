import { Schema } from 'mongoose';
import type { Follow } from '@fg2/shared-types/v1';

/** One person following one public grow, and nothing else: a follow has nothing to say. */
export type FollowDocument = Omit<Follow, 'createdAt'> & { createdAt: Date };

export const followsSchema = new Schema<FollowDocument>(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    growId: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'follows', versionKey: false },
);

// A person follows a grow once. This also serves the home screen, which lists
// the grows the caller follows.
followsSchema.index({ userId: 1, growId: 1 }, { unique: true });

// The other direction: the followers of a grow, for its count and for telling
// them what happened in it.
followsSchema.index({ growId: 1 });
