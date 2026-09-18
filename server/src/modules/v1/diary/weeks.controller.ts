import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { GrowReport, GrowWeekCardPage } from '@fg2/shared-types/v1';
import { growReport, growWeekCardPage } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { V1Answer } from '../answer-shape';
import { GrowReportService } from './report.service';
import { GrowWeeksService } from './weeks.service';

/**
 * The two tabs of the grow page that are not the grow itself: the weeks it is
 * made of, and the report that tells it as chapters.
 *
 * Both are reads of one grow and declare the need every read does, so a member
 * sees them, a share link reaches them clamped to its range, and a public grow
 * answers them to a stranger for as long as it ran.
 */
@ApiTags('grows')
@Controller('v1/grows')
export class GrowWeeksController {
  constructor(
    private readonly weeks: GrowWeeksService,
    private readonly report: GrowReportService,
  ) {}

  @Get(':id/weeks')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The week cards the grow page is made of, newest first' })
  @V1Answer(growWeekCardPage)
  public page(
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Query(pageQuery) query: z.infer<typeof pageQuery>,
  ): Promise<GrowWeekCardPage> {
    return this.weeks.page(id, grant, query);
  }

  @Get(':id/report')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The grow as chapters, one per phase' })
  @V1Answer(growReport)
  public read(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<GrowReport> {
    return this.report.read(id, grant);
  }
}
