import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { V1CommonModule } from '@common/v1/v1.module';
import { DataModule } from '../data/data.module';
import { MailModule } from '../mail/mail.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { AlarmDeliveryService } from './alarm-delivery.service';
import { AlarmEngineService } from './alarm-engine.service';
import { AlarmHealthService } from './alarm-health.service';
import { AlarmRuleService } from './alarm-rule.service';
import { AlarmRulesController, AlertsController, DeviceAlarmRulesController } from './alarm.controller';
import { AlertInboxService } from './alert-inbox.service';
import { AlertService } from './alert.service';

/**
 * Watches what a device reports and what it stops reporting, and tells the owner
 * when something is wrong.
 *
 * `AlarmEngineService.onSample` is what the device protocol hands every reading
 * to; everything else in here is the module's own.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, MailModule, TunnelModule, DataModule],
  controllers: [DeviceAlarmRulesController, AlarmRulesController, AlertsController],
  providers: [AlarmEngineService, AlarmHealthService, AlarmDeliveryService, AlarmRuleService, AlertService, AlertInboxService],
  exports: [AlarmEngineService],
})
export class AlarmModule {}
