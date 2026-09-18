import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { spaceOverview } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { V1Answer } from '../answer-shape';
import { OverviewService } from './overview.service';

/**
 * The tent page's landing tab. It is a read of one space, so it declares the
 * same need every read does and is built from what the guard decided: a share
 * link reaches this route as well as a session - the link is the whole identity
 * a stranger has - and the window it was given is what the answer is clamped to.
 */
@ApiTags('spaces')
@Controller('v1/spaces')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get(':id/overview')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({ summary: 'Everything the tent page opens on, with the 24 h climate verdict' })
  @V1Answer(spaceOverview)
  public read(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<SpaceOverview> {
    return this.overview.read(grant, id);
  }
}
