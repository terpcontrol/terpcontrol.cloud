import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { SpaceTimeline } from '@fg2/shared-types/v1';
import { metric, spaceTimeline, timelineRange } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Query, inOrder, instantQuery, repeated } from '@common/v1/validation';
import { OptionalSessionGuard } from '@common/auth/auth.guard';
import { V1Answer } from '../answer-shape';
import { TimelineService } from './timeline.service';
import { SHARED_READ_OPERATION } from '../../../openapi';

/**
 * Verlauf, the web app's page of curves: one answer per window - a range chip,
 * or two instants somebody stepped back to or zoomed into.
 *
 * It is a read of one space and declares the need every read does, so a member
 * sees it, a demo session sees the demo tent, and a share link reaches it - the
 * link is the whole identity a stranger has, and the window it was given is what
 * the answer is clamped to, whichever chip or window was asked for.
 */
const timelineQuery = inOrder(
  z.object({
    range: timelineRange,
    growId: z.string().min(1).optional().describe('Which grow the bands and the day counter are of. Required by `phase` and `grow`.'),
    at: instantQuery().optional().describe('The instant the window ends at; now by default, and earlier when somebody has scrubbed back.'),
    from: instantQuery()
      .optional()
      .describe(
        'With `to`, a window named outright - stepped back to, zoomed into. It is then the window, and `range` says only which grow it is of.',
      ),
    to: instantQuery().optional().describe('Where that window ends; one end without the other names no window.'),
    stepSeconds: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'The window each point summarises, where somebody chose one. Left out, the width decides: from the 5 seconds a device reports at, for 40 minutes and less, to a 480th of the window.',
      ),
    metrics: repeated(metric)
      .optional()
      .describe(
        'The panels asked for, VPD and PPFD among them; left out, the ones a place measures by itself: temperature, humidity, CO2, leaf and light.',
      ),
    deviceId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'One device standing here, for a place that holds several climates: the panels, bands, nights and lanes are then that device’s alone.',
      ),
  }),
  'from',
  'to',
);

@ApiTags('spaces')
@Controller('v1/spaces')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get(':id/timeline')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({
    summary: 'Everything the Timeline draws over one range: frames, panels, night, alarms, lanes and the lines of the diary',
    ...SHARED_READ_OPERATION,
  })
  @V1Answer(spaceTimeline)
  public read(
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Query(timelineQuery) query: z.infer<typeof timelineQuery>,
  ): Promise<SpaceTimeline> {
    const { from, to, ...asked } = query;
    return this.timeline.read(grant, id, { ...asked, ...(from && to ? { window: { startsAt: from, endsAt: to } } : {}) });
  }
}
