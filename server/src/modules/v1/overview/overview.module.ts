import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { SpaceModule } from '../space/space.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

/**
 * The tent page's read model, a module of its own for the same reason the home
 * screen's is: a space knows what stands in it, not what is due there, how the
 * last day went or what the cameras saw.
 *
 * The service is exported because the answer is also what a share link on a
 * space resolves to, and that is a grant of a different shape rather than a
 * different answer.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, SpaceModule],
  controllers: [OverviewController],
  providers: [OverviewService, OptionalSessionGuard],
  exports: [OverviewService],
})
export class OverviewModule {}
