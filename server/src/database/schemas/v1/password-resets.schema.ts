import { HydratedDocument, Schema } from 'mongoose';

/**
 * A pending password reset. It has no shape in the contract on purpose: nothing
 * of it is ever answered, because what is stored is the hashed half of what was
 * mailed and the other half exists only in that one mail.
 */
export interface StoredPasswordReset {
  id: string;
  createdAt: Date;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type PasswordResetDocument = HydratedDocument<StoredPasswordReset>;

export const passwordResetsSchema = new Schema<StoredPasswordReset>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    userId: { type: String, required: true },
    // The unique index is what a redemption looks the mailed token up by; the
    // value itself is read by no service, so nothing selects it.
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'passwordResets', versionKey: false },
);

// Asking for a new reset, and changing the password, retire the outstanding ones.
passwordResetsSchema.index({ userId: 1 });

// They live for minutes, and an unredeemed one must stop working on its own.
passwordResetsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
