import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
// A default import: the package is CommonJS, and a named import cannot be
// linked from it by a static module reader.
import webPush from 'web-push';
import { v4 as uuidv4 } from 'uuid';
import type { PushPayload, PushSubscription, PushSubscriptionCreate } from '@fg2/shared-types/v1';
import { notFound } from '@common/v1/problem';
import { notificationsConfig, pushAvailable } from '../../../../config/configuration';
import { MODEL_V1 } from '@database/models';
import { StoredPushSubscription } from '@database/schemas/v1/push-subscriptions.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
import { Announcement, Delivered, NotificationChannelSender } from '../notification.types';

/**
 * Web Push, to every browser the person has subscribed.
 *
 * It needs two things before it can say anything: a VAPID key pair in this
 * install's configuration, which is what identifies the sender to a push
 * service, and a subscription, which is what a browser hands over when somebody
 * agrees to be notified. Without the keys the account screen does not offer it
 * at all - `/me` answers a null public key - and without a subscription there is
 * nowhere to send.
 *
 * A push service answers 404 or 410 for a subscription that is over: the
 * browser has been cleared, or the permission withdrawn. That is not a failure
 * to report but a row to remove, and removing it is what stops the next message
 * trying again.
 */
@Injectable()
export class PushChannel implements NotificationChannelSender {
  public readonly name = 'push' as const;

  constructor(
    @InjectModel(MODEL_V1.pushSubscription) private readonly subscriptions: Model<StoredPushSubscription>,
    @Inject(notificationsConfig.KEY) private readonly config: ConfigType<typeof notificationsConfig>,
  ) {}

  /**
   * A browser that agreed to be notified. The endpoint is what identifies it,
   * so a browser that subscribes again - which it does whenever the push
   * service rotates its endpoint or the page asks a second time - replaces its
   * own row instead of collecting duplicates that would each be pushed to.
   */
  public async subscribe(userId: string, body: PushSubscriptionCreate): Promise<PushSubscription> {
    const existing = await this.subscriptions.findOne({ endpoint: body.endpoint }).lean<StoredPushSubscription>();
    if (existing && existing.userId !== userId) {
      // One browser, one account: two accounts pushed to the same endpoint
      // would each be reading the other's notifications.
      await this.subscriptions.deleteOne({ id: existing.id });
    }

    const stored = await this.subscriptions
      .findOneAndUpdate(
        { endpoint: body.endpoint },
        { $set: { userId, keys: body.keys }, $setOnInsert: { id: uuidv4(), createdAt: new Date(), userAgent: null } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<StoredPushSubscription>();

    return serialise(stored!);
  }

  public async unsubscribe(userId: string, id: string): Promise<void> {
    const removed = await this.subscriptions.deleteOne({ id, userId });
    if (removed.deletedCount === 0) throw notFound('push_subscription_not_found', 'There is no subscription of this account with that id.');
  }

  public async send(to: StoredUser, message: Announcement): Promise<Delivered | null> {
    if (!pushAvailable(this.config)) return null;

    const subscriptions = await this.subscriptions.find({ userId: to.id }).lean<StoredPushSubscription[]>();
    if (subscriptions.length === 0) return null;

    // The shape the service worker in the browser reads: named in the contract,
    // because the two are ends of one wire.
    const payload: PushPayload = {
      title: message.title,
      body: message.body,
      category: message.category,
      subject: message.subject,
      severity: message.severity,
      cameraId: message.cameraId ?? null,
    };
    const vapidDetails = {
      subject: this.config.pushContact!,
      publicKey: this.config.pushPublicKey!,
      privateKey: this.config.pushPrivateKey!,
    };

    let delivered = 0;
    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify(payload), { vapidDetails });
        delivered += 1;
      } catch (error) {
        await this.forget(subscription, error);
      }
    }

    // Every browser having gone is the same as there being none: nothing was
    // said, and the log should not claim otherwise.
    return delivered > 0 ? { externalMessageId: null } : null;
  }

  private async forget(subscription: StoredPushSubscription, error: unknown): Promise<void> {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await this.subscriptions.deleteOne({ id: subscription.id });
      logger.info(`Push subscription ${subscription.id} is gone and has been removed`);
      return;
    }

    logger.error(`Failed to push to ${subscription.id}: ${error}`);
  }
}

const serialise = (subscription: StoredPushSubscription): PushSubscription => ({
  id: subscription.id,
  createdAt: subscription.createdAt.toISOString(),
  userId: subscription.userId,
  endpoint: subscription.endpoint,
  keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  userAgent: subscription.userAgent,
});
