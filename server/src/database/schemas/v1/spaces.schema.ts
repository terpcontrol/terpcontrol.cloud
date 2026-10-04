import { Schema } from 'mongoose';
import { presetPrompt, spaceKind } from '@fg2/shared-types/v1-schemas';
import type { Space } from '@fg2/shared-types/v1';

/**
 * A place, which is not a device: a grow stands in a space and a device sits in
 * one, and either exists without the other.
 *
 * Stored is the wire shape with every instant a BSON date, so the schema and the
 * contract cannot describe different fields.
 */
// `youMay` is about whoever is reading and is worked out per request, so it is
// the one field of the wire shape that is not stored beside the others.
export type SpaceDocument = Omit<Space, 'archivedAt' | 'createdAt' | 'youMay'> & {
  archivedAt: Date | null;
  createdAt: Date;
};

export const spacesSchema = new Schema<SpaceDocument>(
  {
    id: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true, index: true },
    kind: { type: String, enum: spaceKind.options, required: true },
    name: { type: String, required: true },
    roomId: { type: String, default: null },
    presetPrompt: { type: String, enum: presetPrompt.options, required: true, default: 'ask' },
    retention: {
      climateDays: { type: Number, default: null },
    },
    isDemo: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'spaces', versionKey: false },
);

// The space list is drawn room by room, and a room's spaces are read whenever a
// membership on the room has to be widened to the spaces it covers.
spacesSchema.index({ ownerId: 1, roomId: 1 });

// The demo session reads every demo object, across owners.
spacesSchema.index({ isDemo: 1 });
