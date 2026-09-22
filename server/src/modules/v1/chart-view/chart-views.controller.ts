import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ChartView, ChartViewCreate, ChartViewPage, ChartViewUpdate } from '@fg2/shared-types/v1';
import { chartView as chartViewShape, chartViewCreate, chartViewPage, chartViewUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { pageLimit } from '@common/v1/pages';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { ChartViewsService } from './chart-views.service';

/**
 * The charts somebody saved to come back to.
 *
 * None of these routes declares a need with the guard: a view stands in nobody's
 * space and belongs to no grow, so there is no subject for `access()` to decide
 * about. What it names is decided when the chart is drawn, by the series routes
 * that answer it, and never here.
 */
@ApiTags('grows')
@Controller('v1/chart-views')
@UseGuards(AuthGuard)
export class ChartViewsController {
  constructor(private readonly views: ChartViewsService) {}

  @Get()
  @ApiOperation({ summary: 'The charts this account has saved, newest first' })
  @V1Answer(chartViewPage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<ChartViewPage> {
    return this.views.list(ctx, query, pageLimit(query.limit));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save the chart as it stands' })
  @V1Answer(chartViewShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(chartViewCreate) body: ChartViewCreate): Promise<ChartView> {
    return this.views.create(ctx, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a saved chart or change what it draws' })
  @V1Answer(chartViewShape)
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(chartViewUpdate) body: ChartViewUpdate): Promise<ChartView> {
    return this.views.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Throw a saved chart away' })
  @ApiNoContentResponse({ description: 'The view is gone. It held the question and never the readings, so no measurement goes with it.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    return this.views.remove(ctx, id);
  }
}
