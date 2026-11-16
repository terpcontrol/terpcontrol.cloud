import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { SpaceModule } from '../space/space.module';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

/**
 * The Timeline of a place, a module of its own for the reason its overview
 * is: a space knows what stands in it, not what was measured there, what was
 * written there or what the cameras saw.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, SpaceModule],
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class TimelineModule {}
