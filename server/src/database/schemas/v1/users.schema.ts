import { HydratedDocument, Schema } from 'mongoose';
import type { NotificationChannels, NotificationSettings, TelegramChannel, User } from '@fg2/shared-types/v1';
import { notificationCategory, notificationChannel, temperatureUnit, volumeUnit, webhookMethod, weightUnit } from '@fg2/shared-types/v1-schemas';

/**
 * The account as it is stored: the contract's `User`, with its instants as BSON
 * dates, plus the password hash the contract deliberately does not carry.
 */
export interface StoredTelegramChannel extends Omit<TelegramChannel, 'linkedAt'> {
  linkedAt: Date;
}

export interface StoredNotificationChannels extends Omit<NotificationChannels, 'telegram'> {
  telegram: StoredTelegramChannel | null;
}

export interface StoredNotificationSettings extends Omit<NotificationSettings, 'channels' | 'mutedUntil'> {
  channels: StoredNotificationChannels;
  mutedUntil: Date | null;
}

export interface StoredUser extends Omit<User, 'createdAt' | 'deletionStartedAt' | 'notifications'> {
  createdAt: Date;
  deletionStartedAt: Date | null;
  notifications: StoredNotificationSettings;
  passwordHash: string;
}

export type UserDocument = HydratedDocument<StoredUser>;

const telegramChannelSchema = new Schema<StoredTelegramChannel>(
  {
    chatId: { type: String, required: true },
    linkedAt: { type: Date, required: true },
  },
  { _id: false },
);

const webhookChannelSchema = new Schema<NonNullable<NotificationChannels['webhook']>>(
  {
    url: { type: String, required: true },
    method: { type: String, enum: [...webhookMethod.options], required: true },
    // A target and its headers can name an internal host and carry an
    // authorisation header, so they are read for their owner alone.
    headers: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
  },
  // A webhook with no headers of its own is the ordinary one, and its empty map
  // has to survive the write: mongoose drops an empty object on its way into the
  // database unless it is told not to, and the contract declares the key
  // required, so what came back was a webhook a client could not read. The
  // alarm rule's webhook already says this, and so does the migrations record.
  { _id: false, minimize: false },
);

const quietHoursSchema = new Schema<NonNullable<NotificationSettings['quietHours']>>(
  {
    fromMinute: { type: Number, required: true, min: 0, max: 1439 },
    toMinute: { type: Number, required: true, min: 0, max: 1439 },
  },
  { _id: false },
);

// The what-goes-where grid, one key per category, so a category added to the
// contract cannot be left out here. `[]` means the category is not announced.
const notificationRouting = Object.fromEntries(
  notificationCategory.options.map(category => [category, { type: [String], enum: [...notificationChannel.options], default: [] }]),
);

export const usersSchema = new Schema<StoredUser>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    email: { type: String, required: true, unique: true },
    // Read by the authentication service alone, which signs somebody in and
    // changes the password; `select: false` keeps it out of every other read.
    passwordHash: { type: String, required: true, select: false },
    isAdmin: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: false },
    // Only an account that signed itself up has one, and only an administrator reads it.
    activationCode: { type: String, default: null },
    handle: { type: String, required: true, unique: true },
    bio: { type: String, default: null },
    avatarMediaId: { type: String, default: null },
    publicProfile: { type: Boolean, required: true, default: false },
    privacy: {
      hideWeights: { type: Boolean, required: true, default: false },
      hideCounts: { type: Boolean, required: true, default: false },
    },
    preferences: {
      // Presentation only: everything is stored in the first value of each enum.
      units: {
        temperature: { type: String, enum: [...temperatureUnit.options], required: true, default: temperatureUnit.options[0] },
        weight: { type: String, enum: [...weightUnit.options], required: true, default: weightUnit.options[0] },
        volume: { type: String, enum: [...volumeUnit.options], required: true, default: volumeUnit.options[0] },
      },
      locale: { type: String, required: true, default: 'en' },
      // An IANA name, and what quiet hours are read in, so the server needs it.
      timezone: { type: String, required: true, default: 'UTC' },
    },
    retention: {
      climateDays: { type: Number, default: null },
    },
    notifications: {
      channels: {
        email: { type: String, default: null },
        telegram: { type: telegramChannelSchema, default: null },
        webhook: { type: webhookChannelSchema, default: null },
      },
      routing: notificationRouting,
      quietHours: { type: quietHoursSchema, default: null },
      mutedUntil: { type: Date, default: null },
    },
    deletionStartedAt: { type: Date, default: null },
  },
  { collection: 'users', versionKey: false },
);

// Deletion is resumable, so the boot sweep asks for the accounts whose deletion
// began and never finished.
usersSchema.index({ deletionStartedAt: 1 }, { partialFilterExpression: { deletionStartedAt: { $type: 'date' } } });
