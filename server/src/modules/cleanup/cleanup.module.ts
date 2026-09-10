import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { CleanupService } from './cleanup.service';

/**
 * The daily sweep for records nothing can reach any more - the logs and pictures
 * of a device that was removed, a picture no diary entry lists, and the stored
 * bytes of a picture whose document never made it.
 */
@Module({
  imports: [ModelsModule],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
