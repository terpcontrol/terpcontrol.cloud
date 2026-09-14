import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { AlarmModule } from '../alarm/alarm.module';
import { CameraModule } from '../camera/camera.module';
import { DataModule } from '../data/data.module';
import { ImageModule } from '../image/image.module';
import { MailModule } from '../mail/mail.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { TunnelModule } from '../tunnel/tunnel.module';
import { DeviceClassService } from './device-class.service';
import { DeviceCommandService } from './device-command.service';
import { DeviceFirmwareController } from './device-firmware.controller';
import { DeviceFirmwareRolloutService } from './device-firmware-rollout.service';
import { DeviceFirmwareService } from './device-firmware.service';
import { DeviceLogController } from './device-log.controller';
import { DeviceLogModule } from './device-log.module';
import { DeviceMessageService } from './device-message.service';
import { DeviceRecipeController } from './device-recipe.controller';
import { DeviceRecipeService } from './device-recipe.service';
import { DeviceRegistrationService } from './device-registration.service';
import { DeviceSettingsModule } from './device-settings.module';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { LegacyDevicePathsController } from './legacy-paths.controller';

/**
 * Everything that is done to a device, and the loops that talk to one. The
 * things that watch a device - its alarms, its measurements, its pictures -
 * are imported here and none of them imports this module back: each depends on
 * the grow diary or the device settings instead, which are modules of their own
 * for exactly that reason.
 */
@Module({
  imports: [
    ModelsModule,
    MqttModule,
    MailModule,
    TunnelModule,
    CameraModule,
    DeviceLogModule,
    DeviceSettingsModule,
    AlarmModule,
    DataModule,
    ImageModule,
  ],
  controllers: [DeviceLogController, DeviceFirmwareController, DeviceRecipeController, DeviceController, LegacyDevicePathsController],
  providers: [
    DeviceService,
    DeviceClassService,
    DeviceCommandService,
    DeviceFirmwareService,
    DeviceFirmwareRolloutService,
    DeviceMessageService,
    DeviceRecipeService,
    DeviceRegistrationService,
  ],
  exports: [DeviceService],
})
export class DeviceModule {}
