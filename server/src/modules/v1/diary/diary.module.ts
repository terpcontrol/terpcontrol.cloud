import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { GrowModule } from '../grow/grow.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { GrowClimateService } from './grow-climate.service';
import { GrowReportService } from './report.service';
import { GrowWeeksController } from './weeks.controller';
import { GrowWeeksService } from './weeks.service';

/**
 * Reading the diary: the timeline itself, the week cards the grow page is made
 * of, and the report that tells a grow as chapters.
 *
 * It is a module of its own rather than routes on grows because the three are
 * read models: they walk from a grow to its diary, its cameras, its scheme and
 * the measurement store, and a grow knows none of that. What it asks of the
 * grow slice is what a grow means - the document, its plants and whose privacy
 * applies - which `GrowsService` answers.
 *
 * Writing an entry is the logging round's and is not here.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, GrowModule],
  controllers: [EntriesController, GrowWeeksController],
  providers: [EntriesService, GrowWeeksService, GrowReportService, GrowClimateService, OptionalSessionGuard],
})
export class DiaryModule {}
