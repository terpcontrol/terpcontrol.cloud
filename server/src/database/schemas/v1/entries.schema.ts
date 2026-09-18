import { Schema } from 'mongoose';
import { Entry, EntryMessage } from '@fg2/shared-types/v1';
import { entryKind, entrySource, severity } from '@fg2/shared-types/v1-schemas';

/**
 * The one timeline. A human's watering, a device's log line and an alarm are all
 * entries, told apart by `kind` and `source`.
 *
 * What is stored is what the contract describes, with the instants as BSON dates
 * rather than the ISO strings that go on the wire. A reference that means nothing
 * is `null` and never absent: the cleanup sweeps delete by `$in` over a list of
 * ids, and a `$in` holding `null` would otherwise also match every document that
 * simply has no such field.
 */
export type EntryDocument = Omit<Entry, 'createdAt' | 'occurredAt' | 'undoUntil'> & {
  createdAt: Date;
  occurredAt: Date;
  undoUntil: Date | null;
};

/** A device's `message-key:param` line, parsed once on the way in. */
const messageSchema = new Schema<EntryMessage>(
  {
    key: { type: String, required: true },
    params: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

export const entriesSchema = new Schema<EntryDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    kind: { type: String, enum: entryKind.options, required: true },
    occurredAt: { type: Date, required: true },
    source: { type: String, enum: entrySource.options, required: true },
    authorId: { type: String, default: null },
    growId: { type: String, default: null },
    spaceId: { type: String, default: null },
    deviceId: { type: String, default: null },
    plantIds: { type: [String], required: true, default: [] },
    cameraId: { type: String, default: null },
    taskId: { type: String, default: null },
    alertId: { type: String, default: null },
    severity: { type: String, enum: severity.options, default: null },
    text: { type: String, default: null },
    message: { type: messageSchema, default: null },
    // One shape per kind, discriminated by the kind it repeats; the contract
    // validates the pair at the boundary and it is stored as it arrives.
    values: { type: Schema.Types.Mixed, required: true },
    mediaIds: { type: [String], required: true, default: [] },
    undoUntil: { type: Date, default: null },
  },
  { collection: 'entries', versionKey: false },
);

// A grow's timeline, newest first: the diary, the week cards and the public page
// all read it, which makes this the busiest index in the database.
entriesSchema.index({ growId: 1, occurredAt: -1 });
// The same timeline for a space, and for one device's own log.
entriesSchema.index({ spaceId: 1, occurredAt: -1 });
entriesSchema.index({ deviceId: 1, occurredAt: -1 });
// Tasks are derived rather than stored, so the entry carrying a task's id is the
// only record that it was done - which is also what makes it the only thing that
// can stop a task being done twice. Two ticks in the same moment both pass a read
// before either writes, so the second is refused here rather than by a check.
// Partial, because every other entry has no task at all.
entriesSchema.index({ taskId: 1 }, { unique: true, partialFilterExpression: { taskId: { $type: 'string' } } });
// Everything logged about one plant, which is what a split grow is read by.
entriesSchema.index({ plantIds: 1, occurredAt: -1 });
