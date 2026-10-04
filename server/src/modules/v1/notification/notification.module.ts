import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { MailModule } from '@modules/mail/mail.module';
import { EmailChannel } from './channels/email.channel';
import { PushChannel } from './channels/push.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { WebhookChannel } from './channels/webhook.channel';
import { NotificationLogService } from './notification-log.service';
import { NotificationService } from './notification.service';
import { NOTIFICATION_CHANNELS, NotificationChannelSender } from './notification.types';
import { NotificationsController, TelegramWebhookController } from './notifications.controller';
import { PlanAnnouncerService } from './plan-announcer.service';
import { RecipientsService } from './recipients.service';
import { TaskAnnouncerService } from './task-announcer.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramUpdatesService } from './telegram-updates.service';
import { WeeklyRecapService } from './weekly-recap.service';

/**
 * Where the server says something to a person.
 *
 * One decision - muted, quiet hours, the routing grid - and four ways of
 * carrying it out. The channels are injected as a list rather than named one by
 * one, so the decision never mentions a channel and a fifth would be a
 * provider and nothing else.
 *
 * What produces a notification lives elsewhere and reaches this through a port:
 * the alarms hand an alert to `ALARM_ROUTING` and a waiting recipe step reaches
 * `PLAN_ANNOUNCER`, both bound where the slices are joined. What lives here
 * instead are the two producers nothing else would notice: a rhythm coming round
 * and a week of pictures closing.
 *
 * The module is exported for those bindings and for nothing else; every other
 * slice should be telling somebody something rather than reaching in here.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, MailModule],
  controllers: [NotificationsController, TelegramWebhookController],
  providers: [
    NotificationService,
    NotificationLogService,
    RecipientsService,
    TaskAnnouncerService,
    WeeklyRecapService,
    PlanAnnouncerService,
    TelegramBotService,
    TelegramUpdatesService,
    EmailChannel,
    PushChannel,
    TelegramChannel,
    WebhookChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      // The order is the order a person is told, which matters only in that the
      // cheapest and most immediate goes first.
      useFactory: (...channels: NotificationChannelSender[]) => channels,
      inject: [PushChannel, TelegramChannel, EmailChannel, WebhookChannel],
    },
  ],
  exports: [NotificationService, PlanAnnouncerService],
})
export class NotificationModule {}
