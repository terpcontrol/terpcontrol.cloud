import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { CameraModule } from '@modules/v1/camera/camera.module';
import { DiaryModule } from '../diary/diary.module';
import { GrowModule } from '../grow/grow.module';
import { OverviewModule } from '../overview/overview.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { LinkShellController } from './link-shell.controller';
import { PublicController } from './public.controller';
import { PublicPagesService } from './public-pages.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksService } from './share-links.service';

/**
 * Letting somebody else read a diary: the links a grower hands out, the grows
 * they follow, and the pages a stranger lands on.
 *
 * It is the one slice that assembles other slices rather than owning much of a
 * model. A public page is the week cards the grow page is made of, the totals
 * the report counts and the card the home screen draws, served through a grant
 * that was decided for somebody with no account - so it reads the diary slice,
 * the grow slice and the tent page rather than building any of them again. What
 * it owns is `shareLinks` and `follows`, and the two pictures a shared address
 * is drawn as.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, CameraModule, DiaryModule, GrowModule, OverviewModule],
  controllers: [ShareLinksController, FollowsController, PublicController, LinkShellController],
  providers: [ShareLinksService, FollowsService, PublicPagesService],
})
export class SharingModule {}
