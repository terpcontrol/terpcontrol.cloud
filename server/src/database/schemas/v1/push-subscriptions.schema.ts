import { HydratedDocument, Schema } from 'mongoose';
import type { PushSubscription, PushSubscriptionKeys } from '@fg2/shared-types/v1';

/** One browser that agreed to be pushed to. The endpoint identifies it, so re-subscribing is an upsert. */
export interface StoredPushSubscription extends Omit<PushSubscription, 'createdAt'> {
  createdAt: Date;
}

export type PushSubscriptionDocument = HydratedDocument<StoredPushSubscription>;

const pushSubscriptionKeysSchema = new Schema<PushSubscriptionKeys>(
  {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  { _id: false },
);

export const pushSubscriptionsSchema = new Schema<StoredPushSubscription>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    userId: { type: String, required: true },
    endpoint: { type: String, required: true, unique: true },
    keys: { type: pushSubscriptionKeysSchema, required: true },
    userAgent: { type: String, default: null },
  },
  { collection: 'pushSubscriptions', versionKey: false },
);

// The send decision reads every subscription of the person being notified.
pushSubscriptionsSchema.index({ userId: 1 });
