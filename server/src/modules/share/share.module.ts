import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { DeviceModule } from '../device/device.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [ModelsModule, DeviceModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
