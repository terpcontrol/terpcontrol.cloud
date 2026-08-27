import { Module } from '@nestjs/common';
import { DeviceFirmwareController } from './device-firmware.controller';
import { DeviceLogController } from './device-log.controller';
import { DeviceRecipeController } from './device-recipe.controller';
import { DeviceRecipeService } from './device-recipe.service';
import { DeviceController } from './device.controller';
import { LegacyDevicePathsController } from './legacy-paths.controller';

@Module({
  controllers: [DeviceLogController, DeviceFirmwareController, DeviceRecipeController, DeviceController, LegacyDevicePathsController],
  providers: [DeviceRecipeService],
})
export class DeviceModule {}
