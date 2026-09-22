import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { CameraModule } from '../camera/camera.module';
import { PhaseModule } from '../phase/phase.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { GrowSeriesService } from './grow-series.service';
import { GrowsController } from './grows.controller';
import { GrowsService } from './grows.service';
import { PlantsController } from './plants.controller';

/**
 * Grows and the plants in them.
 *
 * It depends on the phase writer, and on the measurement store for the two
 * answers that read one - the Charts view and the export. `CLIMATE_PRESETS` is
 * what it asks of the space slice and is bound where the slices are joined, so
 * a grow that enters a phase can put a tent on that stage's preset without
 * knowing anything about presets or about devices.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, PhaseModule, CameraModule],
  controllers: [GrowsController, PlantsController, ExportController],
  providers: [GrowsService, GrowSeriesService, ExportService, OptionalSessionGuard],
  exports: [GrowsService],
})
export class GrowModule {}
