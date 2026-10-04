import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, SubjectRef } from '@common/v1/access.types';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
import { NotificationLogService } from './notification-log.service';
import { TelegramBotService } from './telegram-bot.service';

/**
 * What arrives from Telegram: somebody opening the link, and somebody answering
 * a message the bot sent.
 *
 * The second is the point of the channel. An alarm arrives in a chat, the
 * grower writes "fan was unplugged, fixed" under it, and that sentence belongs
 * in the tent's diary rather than in a chat log - so a reply is turned into an
 * entry, written by the account whose chat it came from and attached to
 * whatever the message it answers was about.
 *
 * Two checks stand in front of that, and both are needed. The reply has to come
 * from the chat the account linked, because a message id is a small number and
 * the alternative is a stranger writing into somebody's diary by guessing one;
 * and the account has to be allowed to log there, decided by the same function
 * every request goes through, because a membership can be taken away while a
 * message somebody was sent is still sitting in their chat.
 */

interface TelegramChat {
  id?: number | string;
}

interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  text?: string;
  reply_to_message?: { message_id?: number };
}

export interface TelegramUpdate {
  message?: TelegramMessage;
}

const START = '/start';

@Injectable()
export class TelegramUpdatesService {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    private readonly bot: TelegramBotService,
    private readonly log: NotificationLogService,
    private readonly entries: EntryWriterService,
    private readonly access: AccessService,
  ) {}

  /**
   * One update. Nothing it can say is an error worth answering with a status:
   * Telegram retries whatever it is not told it has delivered, and an update
   * this install has no use for would then arrive forever.
   */
  public async receive(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const chatId = message?.chat?.id === undefined ? null : String(message.chat.id);
    if (!message || !chatId) return;

    const text = (message.text ?? '').trim();
    if (text.startsWith(START)) return this.link(chatId, text.slice(START.length).trim());
    if (message.reply_to_message?.message_id !== undefined) return this.note(chatId, String(message.reply_to_message.message_id), text);
  }

  /** The link somebody opened: the token names the account, and this chat becomes its channel. */
  private async link(chatId: string, token: string): Promise<void> {
    const userId = token ? this.bot.accountOfLink(token) : null;
    if (!userId) {
      await this.bot.sendMessage(chatId, 'That link is not valid any more. Ask for a new one on the notifications screen.');
      return;
    }

    const linked = await this.users.updateOne({ id: userId }, { $set: { 'notifications.channels.telegram': { chatId, linkedAt: new Date() } } });
    if (linked.matchedCount === 0) {
      logger.error(`A Telegram link named an account that is no longer here: ${userId}`);
      return;
    }

    await this.bot.sendMessage(chatId, 'This chat is now linked. Reply to anything sent here and it goes into the diary.');
  }

  /** A reply, which becomes a line in the diary of whatever it answers. */
  private async note(chatId: string, answering: string, text: string): Promise<void> {
    if (!text) return;

    const told = await this.log.byMessageId('telegram', answering);
    if (!told) return;

    const user = await this.users.findOne({ id: told.userId }).lean<StoredUser>();
    if (user?.notifications.channels.telegram?.chatId !== chatId) return;

    const about = await this.subjectOf(told.subject);
    if (!about) return;

    const ctx: AccessContext = { userId: user.id, isAdmin: user.isAdmin, isDemo: false, shareToken: null };
    if (!(await this.access.access(ctx, about.where, 'log'))) return;

    await this.entries.write({
      source: 'human',
      authorId: user.id,
      values: { kind: 'note' },
      growId: about.growId,
      spaceId: about.spaceId,
      deviceId: about.deviceId,
      alertId: about.alertId,
      text,
    });

    await this.bot.sendMessage(chatId, 'Written to the diary.');
  }

  /**
   * Where a reply belongs. An alarm says which tent it happened in; a task says
   * which grow or space it is about. Anything else the log can carry - a plan
   * step, a timelapse - is not a diary of its own and takes no note.
   */
  private async subjectOf(subject: { type: string; id: string }): Promise<NoteTarget | null> {
    if (subject.type === 'alert') {
      const alert = await this.alerts.findOne({ id: subject.id }).lean<StoredAlert>();
      const where = alert && (alert.spaceId ? subjectRef('space', alert.spaceId) : alert.deviceId ? subjectRef('device', alert.deviceId) : null);
      if (!alert || !where) return null;

      return { where, growId: null, spaceId: alert.spaceId, deviceId: alert.deviceId, alertId: alert.id };
    }

    if (subject.type === 'task') {
      const reminderId = subject.id.split(':')[0];
      const reminder = await this.reminders.findOne({ id: reminderId }).lean<ReminderDocument>();
      if (!reminder) return null;

      const where = subjectRef(reminder.subject.type, reminder.subject.id);
      const grow = reminder.subject.type === 'grow';

      return {
        where,
        growId: grow ? reminder.subject.id : null,
        spaceId: grow ? null : reminder.subject.id,
        deviceId: null,
        alertId: null,
      };
    }

    return null;
  }
}

interface NoteTarget {
  /** What `access()` is asked about, which is the place rather than the message. */
  where: SubjectRef;
  growId: string | null;
  spaceId: string | null;
  deviceId: string | null;
  alertId: string | null;
}
