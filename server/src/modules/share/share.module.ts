import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { DeviceSettingsModule } from '../device/device-settings.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [ModelsModule, DeviceSettingsModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
