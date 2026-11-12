import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { GrowDiaryPage, GrowReport, GrowWeekCardPage } from '@fg2/shared-types/v1';
import { growDiaryPage, growReport, growWeekCardPage } from '@fg2/shared-types/v1-schemas';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Query } from '@common/v1/validation';
import { OptionalSessionGuard } from '@common/auth/auth.guard';
import { V1Answer } from '../answer-shape';
import { GrowDiaryService, diaryQuery } from './grow-diary.service';
import { GrowReportService } from './report.service';
import { GrowWeeksService, weeksQuery } from './weeks.service';
import { SHARED_READ_OPERATION } from '../../../openapi';

/**
 * The reads of the grow page that are not the grow itself: its diary day by
 * day, the weeks a public diary is made of, and the report that tells it as
 * chapters.
 *
 * All are reads of one grow and declare the need every read does, so a member
 * sees them, a share link reaches them clamped to its range, and a public grow
 * answers them to a stranger for as long as it ran.
 */
@ApiTags('grows')
@Controller('v1/grows')
export class GrowWeeksController {
  constructor(
    private readonly weeks: GrowWeeksService,
    private readonly report: GrowReportService,
    private readonly diary: GrowDiaryService,
  ) {}

  @Get(':id/diary')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The grow’s diary, a card per day and a few weeks at a time, newest first', ...SHARED_READ_OPERATION })
  @V1Answer(growDiaryPage)
  public days(@CurrentGrant() grant: Grant, @Param('id') id: string, @V1Query(diaryQuery) query: z.infer<typeof diaryQuery>): Promise<GrowDiaryPage> {
    return this.diary.page(id, grant, query);
  }

  @Get(':id/weeks')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The week cards the grow page is made of, newest first', ...SHARED_READ_OPERATION })
  @V1Answer(growWeekCardPage)
  public page(
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Query(weeksQuery) query: z.infer<typeof weeksQuery>,
  ): Promise<GrowWeekCardPage> {
    return this.weeks.page(id, grant, query);
  }

  @Get(':id/report')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The grow as chapters, one per phase', ...SHARED_READ_OPERATION })
  @V1Answer(growReport)
  public read(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<GrowReport> {
    return this.report.read(id, grant);
  }
}
