import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { AccessGuard } from './access.guard';
import { AccessService } from './access.service';
import { EntryWriterService } from './entry-writer.service';

/**
 * What every `/v1` module builds on: the one decision about access and the one
 * writer of the timeline. Imported by each slice as it is rewritten rather than
 * made global, so what a module depends on stays visible in the module.
 *
 * The answer shapes beside them - the problem filter, the page helper, the
 * validation decorators, the age of a value, the metric names - are functions and
 * decorators and need no provider.
 */
@Module({
  imports: [ModelsModule],
  providers: [AccessService, AccessGuard, EntryWriterService],
  exports: [AccessService, AccessGuard, EntryWriterService],
})
export class V1CommonModule {}
