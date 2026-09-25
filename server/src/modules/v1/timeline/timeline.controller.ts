import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { SpaceTimeline } from '@fg2/shared-types/v1';
import { spaceTimeline, timelineRange } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Query, instantQuery } from '@common/v1/validation';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { V1Answer } from '../answer-shape';
import { TimelineService } from './timeline.service';
import { SHARED_READ_OPERATION } from '../../../openapi';

/**
 * The tent page's Timeline tab: one answer per range chip.
 *
 * It is a read of one space and declares the need every read does, so a member
 * sees it, a demo session sees the demo tent, and a share link reaches it - the
 * link is the whole identity a stranger has, and the window it was given is what
 * the answer is clamped to, whichever chip was asked for.
 */
const timelineQuery = z.object({
  range: timelineRange,
  growId: z.string().min(1).optional().describe('Which grow the bands and the day counter are of. Required by `phase` and `grow`.'),
  at: instantQuery().optional().describe('The instant the window ends at; now by default, and earlier when somebody has scrubbed back.'),
});

@ApiTags('spaces')
@Controller('v1/spaces')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get(':id/timeline')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({
    summary: 'Everything the Timeline tab draws over one range: frames, panels, night, alarms, lanes and the rail',
    ...SHARED_READ_OPERATION,
  })
  @V1Answer(spaceTimeline)
  public read(
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Query(timelineQuery) query: z.infer<typeof timelineQuery>,
  ): Promise<SpaceTimeline> {
    return this.timeline.read(grant, id, query);
  }
}
