import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { SpaceSeries, SpaceTimeline } from '@fg2/shared-types/v1';
import { metric, outputMetric, spaceSeries, spaceTimeline, timelineRange } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Query, inOrder, instantQuery, repeated } from '@common/v1/validation';
import { OptionalSessionGuard } from '@common/auth/auth.guard';
import { V1Answer } from '../answer-shape';
import { SpaceSeriesService } from './space-series.service';
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

/**
 * What the charts page of a place asks for: two instants, the lines it wants,
 * and the step where somebody chose one.
 */
const seriesQuery = inOrder(
  z.object({
    from: instantQuery().describe('Where the window begins.'),
    to: instantQuery().describe('Where it ends.'),
    stepSeconds: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('The window each point summarises, where somebody chose one; widened where it would build more points than one read holds.'),
    metrics: repeated(metric).optional(),
    outputs: repeated(outputMetric).optional(),
  }),
  'from',
  'to',
);

@ApiTags('spaces')
@Controller('v1/spaces')
export class TimelineController {
  constructor(
    private readonly timeline: TimelineService,
    private readonly series: SpaceSeriesService,
  ) {}

  /**
   * Every line the charts page draws of a place, over two instants. It reaches
   * whoever may see the place, a share link clamped to its own window included.
   */
  @Get(':id/series')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({ summary: 'Climate and outputs of a place over any window, at the step asked for', ...SHARED_READ_OPERATION })
  @V1Answer(spaceSeries)
  public seriesOf(
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Query(seriesQuery) query: z.infer<typeof seriesQuery>,
  ): Promise<SpaceSeries> {
    return this.series.read(grant, id, query);
  }

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
