import { Schema } from 'mongoose';
import { GrowOrSpaceRef, ShareLink, ShareLinkState, TimeRange } from '@fg2/shared-types/v1';
import { growOrSpaceType, shareKind } from '@fg2/shared-types/v1-schemas';

/**
 * A link onto a grow or a space, with the window it may be read through.
 *
 * `token` is the secret the link is opened with and is separate from `id`, so a
 * link can be listed, patched and revoked by something that is not a secret. It
 * is answered to whoever may manage the link, because handing the link out is the
 * point of it, and never to a reader who arrived through one.
 */
type TimeRangeDocument = Omit<TimeRange, 'startsAt' | 'endsAt'> & { startsAt: Date | null; endsAt: Date | null };

type ShareLinkStateDocument = Omit<ShareLinkState, 'lastOpenedAt'> & { lastOpenedAt: Date | null };

export type ShareLinkDocument = Omit<ShareLink, 'createdAt' | 'range' | 'expiresAt' | 'revokedAt' | 'state'> & {
  createdAt: Date;
  range: TimeRangeDocument;
  expiresAt: Date | null;
  revokedAt: Date | null;
  state: ShareLinkStateDocument;
};

/** Every read through the link is clamped to this. An open end keeps up with a running diary. */
const rangeSchema = new Schema<TimeRangeDocument>(
  {
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { _id: false },
);

/** One object rather than a row of fields of which exactly one is filled. */
const subjectSchema = new Schema<GrowOrSpaceRef>(
  {
    type: { type: String, enum: growOrSpaceType.options, required: true },
    id: { type: String, required: true },
  },
  { _id: false },
);

/** Counted by the server as the link is opened; never written by a client. */
const stateSchema = new Schema<ShareLinkStateDocument>(
  {
    openCount: { type: Number, required: true, default: 0 },
    lastOpenedAt: { type: Date, default: null },
  },
  { _id: false },
);

export const shareLinksSchema = new Schema<ShareLinkDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    // The secret, and the whole of a reader's proof: `GET /shared/{token}` resolves it.
    token: { type: String, required: true, unique: true },
    kind: { type: String, enum: shareKind.options, required: true },
    subject: { type: subjectSchema, required: true },
    range: { type: rangeSchema, required: true, default: () => ({ startsAt: null, endsAt: null }) },
    includeCameras: { type: Boolean, required: true, default: false },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    state: { type: stateSchema, required: true, default: () => ({ openCount: 0, lastOpenedAt: null }) },
  },
  { collection: 'shareLinks', versionKey: false },
);

// The links onto one grow or one space, which is what its sharing sheet lists
// and what has to be found again when the subject is deleted.
shareLinksSchema.index({ 'subject.type': 1, 'subject.id': 1 });
// Every link one person made, newest first.
shareLinksSchema.index({ createdBy: 1, createdAt: -1 });
