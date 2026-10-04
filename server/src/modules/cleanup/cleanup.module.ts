import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { CleanupService } from './cleanup.service';

/**
 * The daily sweep for records nothing can reach any more - the entries of a grow,
 * a space and a device that are all gone, a picture nothing names any more, and
 * the stored bytes of a picture whose document never made it.
 */
@Module({
  imports: [ModelsModule],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
