import { HydratedDocument, Schema } from 'mongoose';
import type { NotificationLogEntry } from '@fg2/shared-types/v1';
import { notificationCategory, notificationChannel, notificationSubjectType } from '@fg2/shared-types/v1-schemas';

/**
 * What was sent to whom. It keeps a due task from being announced twice, and it
 * maps a reply back to the message it answers; `externalMessageId` is the id the
 * channel gave the message and is null for a channel that gives none.
 */
export interface StoredNotificationLogEntry extends Omit<NotificationLogEntry, 'createdAt' | 'sentAt' | 'expiresAt'> {
  createdAt: Date;
  sentAt: Date;
  expiresAt: Date;
}

export type NotificationLogEntryDocument = HydratedDocument<StoredNotificationLogEntry>;

const subjectSchema = new Schema<NotificationLogEntry['subject']>(
  {
    type: { type: String, enum: [...notificationSubjectType.options], required: true },
    id: { type: String, required: true },
  },
  { _id: false },
);

export const notificationLogSchema = new Schema<StoredNotificationLogEntry>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    userId: { type: String, required: true },
    channel: { type: String, enum: [...notificationChannel.options], required: true },
    category: { type: String, enum: [...notificationCategory.options], required: true },
    subject: { type: subjectSchema, required: true },
    externalMessageId: { type: String, default: null },
    sentAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'notificationLog', versionKey: false },
);

// Before announcing something: has this person already been told about this
// subject, and on which channel?
notificationLogSchema.index({ userId: 1, 'subject.type': 1, 'subject.id': 1, channel: 1, sentAt: -1 });

// An incoming Telegram reply carries the id of the message it answers. The
// partial filter keeps the entries of channels that give no id out of the index,
// where a null would otherwise match every one of them.
notificationLogSchema.index({ externalMessageId: 1 }, { partialFilterExpression: { externalMessageId: { $type: 'string' } } });

// Bookkeeping, not history: an entry lives as long as it can still stop a second
// announcement or match a reply.
notificationLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
