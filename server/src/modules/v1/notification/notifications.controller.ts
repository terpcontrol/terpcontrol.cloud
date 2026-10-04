import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { PushSubscription, PushSubscriptionCreate, TelegramLink } from '@fg2/shared-types/v1';
import { pushSubscription as pushSubscriptionShape, pushSubscriptionCreate, telegramLink } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { AuthContext } from '@common/auth/token.service';
import { conflict, notFound } from '@common/v1/problem';
import { V1Body } from '@common/zod-validation.pipe';
import { MODEL_V1 } from '@database/models';
import { StoredPushSubscription } from '@database/schemas/v1/push-subscriptions.schema';
import { V1Answer } from '../answer-shape';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramUpdate, TelegramUpdatesService } from './telegram-updates.service';

/**
 * How an account switches a channel on.
 *
 * Both of these are the person's half of a channel that also needs the
 * install's: a browser subscribes with the VAPID key this install publishes,
 * and a chat is linked to the bot this install runs. Where the install has
 * neither, there is nothing to switch on and the routes say so rather than
 * accepting something that could never send.
 *
 * The rest of the settings - the addresses, the routing grid, quiet hours and
 * the mute - are fields of the account and are written with it through
 * `PATCH /me`.
 */
@ApiTags('account')
@Controller('v1/me')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    @InjectModel(MODEL_V1.pushSubscription) private readonly subscriptions: Model<StoredPushSubscription>,
    private readonly bot: TelegramBotService,
  ) {}

  /**
   * A browser that agreed to be notified. The endpoint is what identifies it,
   * so a browser that subscribes again - which it does whenever the push
   * service rotates its endpoint or the page asks a second time - replaces its
   * own row instead of collecting duplicates that would each be pushed to.
   */
  @Post('push-subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Let this browser be pushed to' })
  @V1Answer(pushSubscriptionShape, { status: HttpStatus.CREATED })
  public async subscribe(
    @CurrentUser() caller: AuthContext,
    @V1Body(pushSubscriptionCreate) body: PushSubscriptionCreate,
  ): Promise<PushSubscription> {
    const existing = await this.subscriptions.findOne({ endpoint: body.endpoint }).lean<StoredPushSubscription>();
    if (existing && existing.userId !== caller.userId) {
      // One browser, one account: two accounts pushed to the same endpoint
      // would each be reading the other's notifications.
      await this.subscriptions.deleteOne({ id: existing.id });
    }

    const stored = await this.subscriptions
      .findOneAndUpdate(
        { endpoint: body.endpoint },
        { $set: { userId: caller.userId, keys: body.keys }, $setOnInsert: { id: uuidv4(), createdAt: new Date(), userAgent: null } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<StoredPushSubscription>();

    return serialise(stored!);
  }

  @Delete('push-subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop pushing to this browser' })
  @ApiNoContentResponse({ description: 'Gone. The browser keeps its own permission until it withdraws it.' })
  public async unsubscribe(@CurrentUser() caller: AuthContext, @Param('id') id: string): Promise<void> {
    const removed = await this.subscriptions.deleteOne({ id, userId: caller.userId });
    if (removed.deletedCount === 0) throw notFound('push_subscription_not_found', 'There is no subscription of this account with that id.');
  }

  /**
   * The link that binds a chat to this account. It carries its own secret and
   * whoever opens it gets the chat bound, so it is answered to the account that
   * asked for it and is over within the quarter of an hour.
   */
  @Post('telegram-link')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'A link that connects a Telegram chat to this account' })
  @V1Answer(telegramLink, { status: HttpStatus.CREATED })
  public async linkTelegram(@CurrentUser() caller: AuthContext): Promise<TelegramLink> {
    const link = this.bot.link(caller.userId);
    if (!link) throw conflict('telegram_not_configured', 'This installation has no Telegram bot, so there is nothing to link a chat to.');

    return { url: link.url, validUntil: link.validUntil.toISOString() };
  }
}

/**
 * What Telegram posts, at a path only Telegram is told.
 *
 * There is no other guard available: the caller is Telegram's servers and they
 * carry no credential of this install's, so the secret in the path is the
 * whole of it - which is why an install that has not set one serves no webhook
 * at all rather than an open route.
 *
 * It answers 200 to everything it can parse, including what it decides to do
 * nothing about. Telegram redelivers an update it was not told was received,
 * so a refusal here is an update that arrives forever.
 */
@ApiExcludeController()
@Controller('telegram/:secret')
export class TelegramWebhookController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly updates: TelegramUpdatesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async receive(@Param('secret') secret: string, @Body() body: TelegramUpdate): Promise<{ ok: true }> {
    const expected = this.bot.webhookSecret;
    if (!expected || secret !== expected) throw notFound('not_found', 'There is nothing here.');

    await this.updates.receive(body ?? {});
    return { ok: true };
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
