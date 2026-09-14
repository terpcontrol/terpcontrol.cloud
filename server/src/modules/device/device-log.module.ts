import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { DeviceLogService } from './device-log.service';

/**
 * The grow diary on its own, so that everything writing to it - the alarms, the
 * webcam poller, the grow plans - can depend on it without depending on the
 * device module that those same services are driven from.
 */
@Module({
  imports: [ModelsModule],
  providers: [DeviceLogService],
  exports: [DeviceLogService],
})
export class DeviceLogModule {}
