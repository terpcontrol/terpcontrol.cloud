import { HydratedDocument, Schema } from 'mongoose';
import type { Session } from '@fg2/shared-types/v1';

/**
 * A signed-in client. Everything here is the server's own bookkeeping - there is
 * nothing a client writes - so a session has no `state` object to keep apart.
 */
export interface StoredSession extends Omit<Session, 'createdAt' | 'lastSeenAt' | 'expiresAt'> {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export type SessionDocument = HydratedDocument<StoredSession>;

export const sessionsSchema = new Schema<StoredSession>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    userId: { type: String, required: true },
    userAgent: { type: String, default: null },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'sessions', versionKey: false },
);

// `GET /sessions` lists a person's sessions, newest use first.
sessionsSchema.index({ userId: 1, lastSeenAt: -1 });

// A session outlives neither its expiry nor the account: Mongo drops it here,
// and the deletion sweep drops the rest by `userId`.
sessionsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
