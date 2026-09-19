import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { DeviceModule } from '@modules/v1/device/device.module';
import { GrowModule } from '@modules/v1/grow/grow.module';
import { PhaseModule } from '@modules/v1/phase/phase.module';
import { PlanModule } from '@modules/v1/plan/plan.module';
import { ClimatePresetsModule } from './climate-presets.service';
import { PresetApplicationsService } from './preset-applications.service';
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
 *
 * The preset table is this module's, and applying one reaches three ways out of
 * it: the phase writer puts the grow standing here into the stage, the plan is
 * moved on or paused so that it cannot undo the climate an hour later, and the
 * grow slice is what moves a grow here when somebody says to. The write itself
 * sits in `ClimatePresetsModule` rather than here, because the grow slice asks
 * for it through `CLIMATE_PRESETS` and would otherwise have to be built before
 * the routes that depend on it.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, DeviceModule, GrowModule, PhaseModule, PlanModule, ClimatePresetsModule],
  controllers: [SpacesController],
  providers: [SpacesService, SpaceLiveService, PresetApplicationsService],
  exports: [SpacesService, SpaceLiveService, PresetApplicationsService],
})
export class SpaceModule {}
