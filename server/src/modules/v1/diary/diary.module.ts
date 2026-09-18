import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { GrowModule } from '../grow/grow.module';
import { PlanModule } from '../plan/plan.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { EntryWritesService } from './entry-writes.service';
import { GrowClimateService } from './grow-climate.service';
import { GrowReportService } from './report.service';
import { GrowWeeksController } from './weeks.controller';
import { GrowWeeksService } from './weeks.service';
import { TaskCompletionsService } from './task-completions.service';
import { TasksController } from './tasks.controller';

/**
 * The diary: the timeline read and written, the week cards the grow page is made
 * of, the report that tells a grow as chapters, and ticking a task off.
 *
 * It is a module of its own rather than routes on grows because the read models
 * walk from a grow to its diary, its cameras, its scheme and the measurement
 * store, and a grow knows none of that. What it asks of the grow slice is what a
 * grow means - the document, its plants and whose privacy applies - which
 * `GrowsService` answers.
 *
 * `MAINTENANCE_STARTER` is what it expects from outside: "in the tent 15 min"
 * has to quieten the devices standing there, and how a device is told is the
 * device protocol's business.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, GrowModule, PlanModule],
  controllers: [EntriesController, GrowWeeksController, TasksController],
  providers: [
    EntriesService,
    EntryWritesService,
    TaskCompletionsService,
    GrowWeeksService,
    GrowReportService,
    GrowClimateService,
    OptionalSessionGuard,
  ],
})
export class DiaryModule {}
