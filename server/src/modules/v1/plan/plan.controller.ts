import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Plan, PlanReplace, PlanTemplate, PlanTemplateCreate, PlanTemplatePage, PlanTemplateUpdate, PlanTransition } from '@fg2/shared-types/v1';
import {
  plan as planShape,
  planReplace,
  planTemplate as planTemplateShape,
  planTemplateCreate,
  planTemplatePage,
  planTemplateUpdate,
  planTransition,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, CurrentGrant, Requires } from '@common/v1/access.guard';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { notFound } from '@common/v1/problem';
import { clampRange, overlapsRange } from '@common/v1/range';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { PlanTemplatesService } from './plan-templates.service';
import { PlanService } from './plan.service';
import { planOf } from './plan.wire';

/**
 * The grow plan a controller is being run by, and the plans kept to start one
 * from.
 *
 * The needs follow the record: a plan is `manage` on the device it runs, because
 * what it writes is that device's configuration, and reading it is `view` - the
 * same split the alarm rules and the configuration document of the same device
 * are answered under. What a reader who is not a manager does not get is the
 * address the plan mails to; the serialiser decides that, not the route.
 *
 * Where the plan stands is never written by a route here. `PUT` is the steps and
 * nothing else, and confirming, skipping, extending, pausing and resuming are
 * one noun below the plan - `transitions` - because each is a thing that happens
 * to the plan rather than a field of it, and because the engine makes the same
 * moves on its own clock through the same service.
 */

const planStopQuery = z.object({
  steps: z
    .enum(['keep', 'remove'])
    .optional()
    .describe('`keep`, the default, stops the plan and keeps its steps to start again; `remove` takes the plan off the device altogether.'),
});
@ApiTags('plans')
@Controller('v1/devices/:id/plan')
@UseGuards(AuthGuard, AccessGuard)
export class DevicePlanController {
  constructor(
    private readonly plans: PlanService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @Requires('view', 'device')
  @ApiOperation({ summary: 'The plan this device is being run by, and where it stands in it' })
  @V1Answer(planShape)
  public async read(@Caller() ctx: AccessContext, @CurrentGrant() grant: Grant, @Param('id') deviceId: string): Promise<Plan> {
    const plan = await this.plans.require(deviceId);

    // A plan is what a device is being run by now, so there is no window of
    // history in it for `clampRange` to narrow - but there is the question of
    // whether now is inside the caller's window at all. A link onto a grow that
    // ran in the spring is a key to that spring, and what the tent is being run
    // by in July is not part of it.
    if (!overlapsRange(clampRange(grant), new Date(), new Date())) {
      throw notFound('plan_not_found', 'This device is not running a plan.');
    }

    return planOf(plan, await this.mayManage(ctx, deviceId));
  }

  /**
   * The whole plan, written in place of whatever the device had. A device runs
   * one, so this both writes the first and replaces the one that is there.
   *
   * It does not start the plan. Saving a plan and running one are two things a
   * person does, and a tent that went onto a step the moment somebody pressed
   * save would be a change they never asked for; "start" is a `resume`.
   */
  @Put()
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Set or replace the plan this device runs' })
  @V1Answer(planShape)
  public async write(@Param('id') deviceId: string, @V1Body(planReplace) body: PlanReplace): Promise<Plan> {
    return planOf(await this.plans.replace(deviceId, body), true);
  }

  /**
   * Stopping a plan, which is not deleting it: it keeps its steps and stands at
   * the first one again, so the plan screen can start it over. The device keeps
   * the settings the last step gave it - stopping says nothing about what a tent
   * should be doing instead.
   *
   * Taking the plan away is asked for by name, because stopping has always been
   * this route and is safe to repeat: a screen may stop a plan it last read a
   * minute ago, and must not throw its steps away by doing so twice.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Stop running the plan, keeping its steps, or take it away with `steps=remove`' })
  @ApiNoContentResponse({
    description: 'The plan is at rest, or gone with `steps=remove`; either way the device is left where the last step put it.',
  })
  public async stop(@Param('id') deviceId: string, @V1Query(planStopQuery) query: z.infer<typeof planStopQuery>): Promise<void> {
    if (query.steps === 'remove') await this.plans.remove(deviceId);
    else await this.plans.stop(deviceId);
  }

  @Post('transitions')
  @HttpCode(HttpStatus.CREATED)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Confirm, skip, extend, pause or resume the running step' })
  @V1Answer(planShape, { status: HttpStatus.CREATED, description: 'The plan as the move left it.' })
  public async move(@Caller() ctx: AccessContext, @Param('id') deviceId: string, @V1Body(planTransition) body: PlanTransition): Promise<Plan> {
    return planOf(await this.plans.transition(deviceId, body, ctx.userId), true);
  }

  /** Whether the caller may manage the device, which is what decides how much of the plan is serialised. */
  private async mayManage(ctx: AccessContext, deviceId: string): Promise<boolean> {
    return !!(await this.access.access(ctx, subjectRef('device', deviceId), 'manage'));
  }
}

/**
 * The plans somebody keeps to start others from.
 *
 * None of these routes declares a need with the guard: a template is nobody's
 * device and stands in nobody's space, so there is no subject for `access()` to
 * decide about. Whose it is and whether its author published it are the whole of
 * it, and the service says so where it reads them.
 */
@ApiTags('plans')
@Controller('v1/plan-templates')
@UseGuards(AuthGuard)
export class PlanTemplatesController {
  constructor(private readonly templates: PlanTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'The plan templates this account may start from' })
  @V1Answer(planTemplatePage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<PlanTemplatePage> {
    return this.templates.list(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Keep a plan to start others from' })
  @V1Answer(planTemplateShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(planTemplateCreate) body: PlanTemplateCreate): Promise<PlanTemplate> {
    return this.templates.create(ctx, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One plan template' })
  @V1Answer(planTemplateShape)
  public read(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<PlanTemplate> {
    return this.templates.read(ctx, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a template, publish it, or change its steps' })
  @V1Answer(planTemplateShape)
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(planTemplateUpdate) body: PlanTemplateUpdate): Promise<PlanTemplate> {
    return this.templates.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Throw a template away' })
  @ApiNoContentResponse({ description: 'The template is gone; a plan started from it keeps its own steps and runs on.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    return this.templates.remove(ctx, id);
  }
}
