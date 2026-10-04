import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { PhaseWriterService } from './phase-writer.service';

/**
 * The phase writer, on its own: the grow routes, the plan engine and
 * `preset-applications` all put a grow into a phase, and each of them would
 * otherwise depend on the module of another.
 *
 * `STAGE_ALARMS` is the one thing this module asks of the rest of the server,
 * answered by the alarm module and bound where the slices are joined -
 * optionally, so a phase is written whether or not anything is listening for
 * it. The writer is in turn what the device slice asks, through
 * `DEVICE_PLACEMENT`, for the stage a device has just been stood in.
 */
@Module({
  imports: [ModelsModule, V1CommonModule],
  providers: [PhaseWriterService],
  exports: [PhaseWriterService],
})
export class PhaseModule {}
