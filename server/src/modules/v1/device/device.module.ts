import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { DeviceProtocolModule } from '@modules/device-protocol/device-protocol.module';
import { AdminDevicesController } from './admin-devices.controller';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { FleetModule } from '../fleet/fleet.module';

/**
 * A device as a person deals with it: claiming one, naming it, putting it
 * somewhere, telling it to do something, reading what it measures.
 *
 * It depends on the device protocol and not the other way round - what a command
 * looks like on the wire is frozen and belongs there, and who may send one is
 * decided here.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, DeviceProtocolModule, FleetModule],
  controllers: [DevicesController, AdminDevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DeviceModule {}
