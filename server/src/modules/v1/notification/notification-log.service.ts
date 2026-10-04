import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { NotificationCategory, NotificationChannel } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredNotificationLogEntry } from '@database/schemas/v1/notification-log.schema';
import { Announcement } from './notification.types';

/**
 * What was said to whom.
 *
 * Two questions are answered from it and nothing else is: has this person
 * already been told about this thing, which is what keeps a task that is due
 * all day from being announced every hour, and what does this reply answer,
 * which is how a Telegram message somebody answers becomes a note in the right
 * diary.
 *
 * It is bookkeeping rather than history, so every row carries the instant it
 * stops being either of those and the collection's TTL index removes it then.
 */

/** Long enough for a rhythm's next occurrence to be a different thing, and for a reply to still make sense. */
const KEPT_DAYS = 30;

@Injectable()
export class NotificationLogService {
  constructor(@InjectModel(MODEL_V1.notificationLogEntry) private readonly log: Model<StoredNotificationLogEntry>) {}

  public async record(
    userId: string,
    channel: NotificationChannel,
    category: NotificationCategory,
    subject: Announcement['subject'],
    externalMessageId: string | null,
  ): Promise<void> {
    const sentAt = new Date();

    await this.log.create({
      id: uuidv4(),
      createdAt: sentAt,
      userId,
      channel,
      category,
      subject,
      externalMessageId,
      sentAt,
      expiresAt: new Date(sentAt.getTime() + KEPT_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  /** Whether this person has already been told about this, on any channel. */
  public async told(userId: string, subject: Announcement['subject']): Promise<boolean> {
    return !!(await this.log.exists({ userId, 'subject.type': subject.type, 'subject.id': subject.id }));
  }

  /** What a reply answers: the message the channel gave that id to. */
  public byMessageId(channel: NotificationChannel, externalMessageId: string): Promise<StoredNotificationLogEntry | null> {
    return this.log.findOne({ channel, externalMessageId }).sort({ sentAt: -1 }).lean<StoredNotificationLogEntry>();
  }
}
