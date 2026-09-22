import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { SpaceModule } from '@modules/v1/space/space.module';
import { InvitesController, SpaceInvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

/**
 * Sharing a place rather than a diary: the people in a space, and the codes that
 * let somebody become one.
 *
 * It is its own slice and not part of the sharing module, which owns the links a
 * stranger reads a grow through. The two are opposite acts. A share link hands
 * out a window onto history and its holder gains nothing, which is why it is
 * decided entirely inside `access()`; a membership hands somebody the run of a
 * tent from now on, and is the only thing in the model that widens what a
 * second account may do.
 *
 * It depends on the space module because a space is what both collections hang
 * off, and nothing depends on it: `access()` reads `memberships` directly, so
 * every other slice already honours a membership without knowing these routes
 * exist.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, SpaceModule],
  controllers: [MembersController, SpaceInvitesController, InvitesController],
  providers: [MembersService, InvitesService],
})
export class MembersModule {}
