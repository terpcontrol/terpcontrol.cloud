import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { DeviceLogModule } from './device-log.module';
import { DeviceSettingsService } from './device-settings.service';

/**
 * How a device is set up, on its own: the measurement store reads a device's
 * leaf temperature offsets to work out VPD, and would otherwise have to depend
 * on the device module that writes measurements to it.
 */
@Module({
  imports: [ModelsModule, MqttModule, DeviceLogModule],
  providers: [DeviceSettingsService],
  exports: [DeviceSettingsService],
})
export class DeviceSettingsModule {}
