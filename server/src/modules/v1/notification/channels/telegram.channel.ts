import { Injectable } from '@nestjs/common';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { TelegramBotService } from '../telegram-bot.service';
import { Announcement, Delivered, NotificationChannelSender } from '../notification.types';

/**
 * The install's Telegram bot, in the chat this person linked.
 *
 * Off twice over: an install with no bot token has no bot, and an account that
 * has not opened the link has no chat. The message's id is kept, because a
 * reply to it is how somebody answers an alarm with a note - which is the one
 * channel here that carries a conversation rather than a message.
 */
@Injectable()
export class TelegramChannel implements NotificationChannelSender {
  public readonly name = 'telegram' as const;

  constructor(private readonly bot: TelegramBotService) {}

  public async send(to: StoredUser, message: Announcement): Promise<Delivered | null> {
    const chat = to.notifications.channels.telegram;
    if (!this.bot.available || !chat) return null;

    const sent = await this.bot.sendMessage(chat.chatId, `${message.title}\n\n${message.body}`);

    return sent === null ? null : { externalMessageId: sent };
  }
}
