import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { DataService } from './data.service';

/**
 * The measurement store. It has no routes of its own: what a client may read of
 * a device's history hangs off the device, and the store is what answers it.
 */
@Module({
  imports: [ModelsModule],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
