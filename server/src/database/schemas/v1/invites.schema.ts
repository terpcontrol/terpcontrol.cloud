import { Schema } from 'mongoose';
import { memberRole } from '@fg2/shared-types/v1-schemas';
import type { Invite, InviteState } from '@fg2/shared-types/v1';

type InviteStateDocument = Omit<InviteState, 'lastUsedAt'> & { lastUsedAt: Date | null };

/**
 * An invitation to a space. The code is the link, the typed code and the QR at
 * once, and it is the whole proof of the invitation: it is answered only to
 * whoever may manage the space, and a redemption addresses it without being
 * told anything about it.
 */
export type InviteDocument = Omit<Invite, 'expiresAt' | 'revokedAt' | 'state' | 'createdAt'> & {
  expiresAt: Date | null;
  revokedAt: Date | null;
  state: InviteStateDocument;
  createdAt: Date;
};

export const invitesSchema = new Schema<InviteDocument>(
  {
    id: { type: String, required: true, unique: true },
    code: { type: String, required: true, unique: true },
    spaceId: { type: String, required: true, index: true },
    role: { type: String, enum: memberRole.options, required: true },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // Maintained by the server, never written by a client.
    state: {
      useCount: { type: Number, required: true, default: 0 },
      lastUsedAt: { type: Date, default: null },
    },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'invites', versionKey: false },
);
