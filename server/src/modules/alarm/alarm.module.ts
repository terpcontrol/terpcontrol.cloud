import { forwardRef, Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { DataModule } from '../data/data.module';
import { DeviceModule } from '../device/device.module';
import { MailModule } from '../mail/mail.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { AlarmService } from './alarm.service';

/** Watches the readings a device reports and tells the owner when one is out of range. */
@Module({
  imports: [ModelsModule, MailModule, TunnelModule, forwardRef(() => DeviceModule), forwardRef(() => DataModule)],
  providers: [AlarmService],
  exports: [AlarmService],
})
export class AlarmModule {}
