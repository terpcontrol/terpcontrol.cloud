import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { GrowModule } from '../grow/grow.module';
import { PlanModule } from '../plan/plan.module';
import { SpaceModule } from '../space/space.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { EntryWritesService } from './entry-writes.service';
import { GrowClimateService } from './grow-climate.service';
import { GrowReportService } from './report.service';
import { GrowWeeksController } from './weeks.controller';
import { GrowWeeksService } from './weeks.service';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { TaskCompletionsService } from './task-completions.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { VisibleSubjectsService } from './visible-subjects.service';

/**
 * The diary: the timeline read and written, the week cards the grow page is made
 * of, the report that tells a grow as chapters, the rhythms somebody is kept to
 * and the tasks derived from them.
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
 *
 * The space slice is imported for one thing: a task is not a document, so a
 * list of them cannot be decided per row and the places a person keeps have to
 * be worked out first. `SpacesService.visibleTo` is that rule, and reading it
 * here is what keeps it from being written a second time.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, GrowModule, PlanModule, SpaceModule],
  controllers: [EntriesController, GrowWeeksController, RemindersController, TasksController],
  providers: [
    EntriesService,
    EntryWritesService,
    RemindersService,
    TaskCompletionsService,
    TasksService,
    VisibleSubjectsService,
    GrowWeeksService,
    GrowReportService,
    GrowClimateService,
    OptionalSessionGuard,
  ],
  // The week cards and the two figures above the chapters are what a public
  // diary is made of as well, so the sharing slice reads them from here rather
  // than assembling a grow's story a second way.
  exports: [GrowWeeksService, GrowReportService],
})
export class DiaryModule {}
