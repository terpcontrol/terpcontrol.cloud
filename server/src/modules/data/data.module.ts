import { Module } from '@nestjs/common';
import { DeviceSettingsModule } from '../device/device-settings.module';
import { DataController } from './data.controller';
import { DATA_SERVICE } from './data.provider';
import { DataService } from './data.service';

@Module({
  imports: [DeviceSettingsModule],
  controllers: [DataController],
  // The controller takes the contract rather than the class, so what it needs
  // of the measurement store is stated in one place.
  providers: [DataService, { provide: DATA_SERVICE, useExisting: DataService }],
  exports: [DataService],
})
export class DataModule {}
