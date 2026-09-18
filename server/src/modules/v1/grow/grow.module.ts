import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { PhaseModule } from '../phase/phase.module';
import { GrowsController } from './grows.controller';
import { GrowsService } from './grows.service';
import { PlantsController } from './plants.controller';

/**
 * Grows and the plants in them.
 *
 * It depends on the phase writer and on nothing else of the rest of the server:
 * `CLIMATE_PRESETS` is what it asks of the space slice and is bound where the
 * slices are joined, so a grow that enters a phase can put a tent on that
 * stage's preset without knowing anything about presets or about devices.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, PhaseModule],
  controllers: [GrowsController, PlantsController],
  providers: [GrowsService],
  exports: [GrowsService],
})
export class GrowModule {}
