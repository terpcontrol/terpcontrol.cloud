import type { NotificationCategory, NotificationChannel, NotificationSubjectType, Severity } from '@fg2/shared-types/v1';
import { StoredUser } from '@database/schemas/v1/users.schema';

/**
 * What a notification is, and what a channel is asked to do with it.
 *
 * One message, four ways of saying it. The decision about whether to say
 * anything at all - muted, quiet hours, the routing grid - is taken once, in
 * `NotificationService`, and a channel is only ever asked to deliver something
 * that decision has already allowed. A channel's own question is narrower: has
 * this install, and this person, configured it? Every one of them answers null
 * where the answer is no, because off-until-configured is the rule and a
 * channel that guessed an address would break it.
 */

export interface Announcement {
  category: NotificationCategory;
  /** What it is about, which is what the log records so that nothing is said twice. */
  subject: { type: NotificationSubjectType; id: string };
  /** Critical is the one thing quiet hours do not hold back. */
  severity: Severity;
  title: string;
  body: string;
}

/** What a channel answers when it has sent something. */
export interface Delivered {
  /** The id the channel gave the message, for a channel that gives one - which is how a reply is matched back. */
  externalMessageId: string | null;
}

export interface NotificationChannelSender {
  readonly name: NotificationChannel;
  /** Null where this install or this person has not configured the channel, which is also how it is turned off. */
  send(to: StoredUser, message: Announcement): Promise<Delivered | null>;
}

/** The senders, injected as one list so that the decision never names a channel. */
export const NOTIFICATION_CHANNELS = Symbol('NotificationChannels');
