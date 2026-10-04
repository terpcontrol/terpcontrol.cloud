import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import type { NotificationChannel, Severity } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { StoredNotificationSettings, StoredUser } from '@database/schemas/v1/users.schema';
import { AlarmEvent, AlarmRouting } from '@modules/alarm/alarm.types';
import { logger } from '@utils/logger';
import { alertAnnouncement } from './notification-messages';
import { NOTIFICATION_CHANNELS, Announcement, NotificationChannelSender } from './notification.types';
import { NotificationLogService } from './notification-log.service';
import { RecipientsService } from './recipients.service';

/**
 * One send decision per person.
 *
 * Everything the server wants to say goes through here, and here is where it is
 * decided whether it is said at all: muted, then quiet hours, then the routing
 * grid, which names the channels each category goes out on. An empty list is a
 * category that is not announced - and an empty grid, which is what every
 * account starts and every migrated account arrives with, is an account that is
 * told nothing until somebody asks to be.
 *
 * "Mute all" mutes critical alarms too, for the person who tapped it and for
 * nobody else. Quiet hours do not: a tent that is freezing at four in the
 * morning is the one thing worth waking somebody for.
 *
 * The alarms reach this through `ALARM_ROUTING`, so the alarm module knows that
 * a message may be routed somewhere without knowing what a channel is.
 */
@Injectable()
export class NotificationService implements AlarmRouting {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannelSender[],
    private readonly log: NotificationLogService,
    private readonly recipients: RecipientsService,
  ) {}

  /**
   * An alarm, to everybody who keeps the place it happened in. A rule with a
   * delivery of its own never arrives here - that is the alarm module's own
   * decision - so what reaches this is either a routed rule or something the
   * health loop raised, which has no rule to address itself. Its severity says
   * which row of the grid it goes out on, and an info alarm is on no row at
   * all: it is in the inbox and in the diary, and nobody's phone goes off.
   */
  public async deliver(event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null): Promise<void> {
    const message = alertAnnouncement(event, alert, rule);
    if (!message) return;

    for (const userId of await this.peopleFor(alert)) await this.tell(userId, message);
  }

  /**
   * The decision, for one person and one message. It is the only way anything
   * is sent, and it answers which channels actually said it.
   */
  public async tell(userId: string, message: Announcement): Promise<NotificationChannel[]> {
    const user = await this.users.findOne({ id: userId }).lean<StoredUser>();
    if (!user || !user.isActive || user.deletionStartedAt) return [];
    if (heldBack(user.notifications, message.severity, user.preferences.timezone)) return [];

    const wanted = new Set(user.notifications.routing[message.category] ?? []);
    const sent: NotificationChannel[] = [];

    for (const channel of this.channels) {
      if (!wanted.has(channel.name)) continue;

      try {
        const delivered = await channel.send(user, message);
        if (!delivered) continue;

        await this.log.record(user.id, channel.name, message.category, message.subject, delivered.externalMessageId);
        sent.push(channel.name);
      } catch (error) {
        logger.error(`Failed to notify ${user.id} on ${channel.name}: ${error}`);
      }
    }

    return sent;
  }

  /** The same, unless this person has already been told about this thing. */
  public async tellOnce(userId: string, message: Announcement): Promise<NotificationChannel[]> {
    if (await this.told(userId, message.subject)) return [];

    return this.tell(userId, message);
  }

  /** Whether this person has already been told about this thing, whichever channel it went out on. */
  public told(userId: string, subject: Announcement['subject']): Promise<boolean> {
    return this.log.told(userId, subject);
  }

  /**
   * Whether this person is being kept quiet at this moment.
   *
   * Saying nothing has two quite different reasons behind it, and a caller with
   * news that keeps - a plan standing still until somebody answers it - has to
   * be able to tell them apart: a grid that asks for nothing on this row is an
   * answer, and will be the same answer in an hour, while a mute or a night is
   * only a not-now and is worth coming back after.
   */
  public async silenced(userId: string, severity: Severity): Promise<boolean> {
    const user = await this.users.findOne({ id: userId }).lean<StoredUser>();

    return !!user && heldBack(user.notifications, severity, user.preferences.timezone);
  }

  /** Everybody who could have read the alert: what it is about decides, in the order it names things. */
  private peopleFor(alert: StoredAlert): Promise<string[]> {
    if (alert.spaceId) return this.recipients.forSpace(alert.spaceId);
    if (alert.deviceId) return this.recipients.forDevice(alert.deviceId);
    if (alert.cameraId) return this.recipients.forCamera(alert.cameraId);

    return Promise.resolve([]);
  }
}

/**
 * Silence, in the two shapes a person can ask for it. A mute is absolute, on
 * purpose: somebody who taps "mute all" while they work on a tent means every
 * alarm the tent is about to raise. Quiet hours are a night's sleep, and a
 * critical alarm is worth interrupting one.
 */
const heldBack = (settings: StoredNotificationSettings, severity: Severity, timezone: string): boolean => {
  if (settings.mutedUntil && settings.mutedUntil.getTime() > Date.now()) return true;
  if (severity === 'critical') return false;

  return inQuietHours(settings.quietHours, timezone);
};

/**
 * A window with no date on it, read in the person's own time zone: it is
 * minutes from their midnight, so the same setting means the same night
 * wherever the server stands. A window that crosses midnight has its start
 * after its end, which is what the two branches are.
 */
export const inQuietHours = (quiet: StoredNotificationSettings['quietHours'], timezone: string, at: Date = new Date()): boolean => {
  if (!quiet) return false;

  // A time zone the account carries but this host has never heard of would
  // otherwise make every window unreadable; UTC is the server's own clock.
  const local = DateTime.fromJSDate(at, { zone: timezone || 'UTC' });
  const clock = local.isValid ? local : DateTime.fromJSDate(at, { zone: 'UTC' });
  const minute = clock.hour * 60 + clock.minute;

  return quiet.fromMinute <= quiet.toMinute
    ? minute >= quiet.fromMinute && minute < quiet.toMinute
    : minute >= quiet.fromMinute || minute < quiet.toMinute;
};
