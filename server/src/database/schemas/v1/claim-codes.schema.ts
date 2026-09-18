import { Schema } from 'mongoose';
import type { ClaimCode } from '@fg2/shared-types/v1';

/** The code a device shows on its display, which is the whole proof a claim needs. One per device. */
export interface StoredClaimCode extends Omit<ClaimCode, 'createdAt'> {
  createdAt: Date;
}

export const claimCodesSchema = new Schema<StoredClaimCode>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    code: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, unique: true },
  },
  { collection: 'claimCodes', versionKey: false },
);
