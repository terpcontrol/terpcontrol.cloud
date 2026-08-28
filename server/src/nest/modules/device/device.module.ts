import { forwardRef, Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { AlarmModule } from '../alarm/alarm.module';
import { CameraModule } from '../camera/camera.module';
import { DataModule } from '../data/data.module';
import { ImageModule } from '../image/image.module';
import { MailModule } from '../mail/mail.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { DeviceFirmwareController } from './device-firmware.controller';
import { DeviceLogController } from './device-log.controller';
import { DeviceRecipeController } from './device-recipe.controller';
import { DeviceRecipeService } from './device-recipe.service';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { LegacyDevicePathsController } from './legacy-paths.controller';

/**
 * The device and the things that watch it - alarms, measurements, pictures -
 * refer to each other in both directions, which is what the forwardRefs are:
 * a device reports a reading that raises an alarm, and an alarm reads the
 * device's own series back to decide whether it has held long enough.
 */
@Module({
  imports: [
    ModelsModule,
    MqttModule,
    MailModule,
    TunnelModule,
    CameraModule,
    forwardRef(() => AlarmModule),
    forwardRef(() => DataModule),
    forwardRef(() => ImageModule),
  ],
  controllers: [DeviceLogController, DeviceFirmwareController, DeviceRecipeController, DeviceController, LegacyDevicePathsController],
  providers: [DeviceService, DeviceRecipeService],
  exports: [DeviceService],
})
export class DeviceModule {}
