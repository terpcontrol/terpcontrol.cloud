import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { DeviceModule } from '@modules/v1/device/device.module';
import { SpaceLiveService } from './space-live.service';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

/**
 * The places, which everything else on the home screen hangs off.
 *
 * It depends on the device module and not the other way round: where a device
 * stands is the device's own field, and a space only says which devices it will
 * take. What is read to decide whether a space may end - a camera, a grow - is
 * read from the collections that carry the pointer, because the answer is the
 * pointer and not a behaviour of the module that owns it.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, DeviceModule],
  controllers: [SpacesController],
  providers: [SpacesService, SpaceLiveService],
  exports: [SpacesService, SpaceLiveService],
})
export class SpaceModule {}
