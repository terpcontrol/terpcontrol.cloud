import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { logger } from '@utils/logger';
import { authConfig, notificationsConfig } from '../../../config/configuration';
import { LINK_VALID_MS, mintTelegramLink, readTelegramLink } from './telegram-link';

/**
 * The install's bot: one per install, as the record decides, rather than one
 * per account.
 *
 * Everything about it is configuration - the token it speaks with, the name its
 * link is opened at, and the secret its webhook is served behind - and the bot
 * does not exist until all three are set. That is not a formality: the webhook
 * is an outward-facing route that anybody can post to, so without a secret to
 * hide it behind there is nothing to serve, and without a name there is no link
 * to hand anybody.
 */

const TELEGRAM_API = 'https://api.telegram.org';

interface SentMessage {
  ok?: boolean;
  result?: { message_id?: number };
  description?: string;
}

@Injectable()
export class TelegramBotService {
  constructor(
    @Inject(notificationsConfig.KEY) private readonly config: ConfigType<typeof notificationsConfig>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  /** Whether this install has a bot at all, which is what `/me` reports and the screens read. */
  public get available(): boolean {
    return !!(this.config.telegramBotToken && this.config.telegramBotUsername);
  }

  /** Whether the webhook exists. Without a secret in front of it, it does not. */
  public get webhookSecret(): string | null {
    return this.available ? this.config.telegramWebhookSecret : null;
  }

  /** The link that starts the chat, and when it stops working. Null where there is no bot to link to. */
  public link(userId: string, at: Date = new Date()): { url: string; validUntil: Date } | null {
    if (!this.available) return null;

    const validUntil = new Date(at.getTime() + LINK_VALID_MS);
    const token = mintTelegramLink(this.auth.secretKey, userId, validUntil);

    return token === null ? null : { url: `https://t.me/${this.config.telegramBotUsername}?start=${token}`, validUntil };
  }

  /** Whose account a `/start` payload names, or null for one that is forged or over. */
  public accountOfLink(token: string, at: Date = new Date()): string | null {
    return this.available ? readTelegramLink(this.auth.secretKey, token, at) : null;
  }

  /** The id Telegram gave the message, or null where nothing was sent. */
  public async sendMessage(chatId: string, text: string): Promise<string | null> {
    if (!this.config.telegramBotToken) return null;

    const response = await fetch(`${TELEGRAM_API}/bot${this.config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
    });

    const answer = (await response.json().catch(() => ({}))) as SentMessage;
    if (!response.ok || !answer.ok) {
      logger.error(`Telegram refused a message to ${chatId}: ${answer.description ?? response.status}`);
      return null;
    }

    return answer.result?.message_id === undefined ? null : String(answer.result.message_id);
  }
}
