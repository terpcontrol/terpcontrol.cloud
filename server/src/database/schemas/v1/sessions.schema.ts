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

// `GET /sessions` lists a person's sessions, newest sign-in first. On
// `createdAt` rather than on `lastSeenAt`, because that is what the list pages
// by: a refresh rewrites `lastSeenAt` on a row every few minutes, and a cursor
// walk over a key that moves loses the rows that move past it.
sessionsSchema.index({ userId: 1, createdAt: -1 });

// A session outlives neither its expiry nor the account: Mongo drops it here,
// and the deletion sweep drops the rest by `userId`.
sessionsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
