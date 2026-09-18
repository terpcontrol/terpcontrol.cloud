import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type {
  GrowCreate,
  GrowListItem,
  GrowPage,
  GrowUpdate,
  Phase,
  Placement,
  PlacementCreate,
  PhaseCreate,
  Plant,
  PlantPage,
  PlantCreate,
} from '@fg2/shared-types/v1';
import {
  growCreate,
  growListItem,
  growPage,
  growUpdate,
  phase as phaseShape,
  phaseCreate,
  placement as placementShape,
  placementCreate,
  plantCreate,
  plant as plantShape,
  plantPage,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, CurrentGrant, Requires } from '@common/v1/access.guard';
import { AccessContext, Grant } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { GrowsService } from './grows.service';

/**
 * A grow, and what a person does to one.
 *
 * Everything a screen shows about a grow that is not stored - the day counter,
 * the phase and its "auto" tag, the week the feeding grid is read at, the groups
 * a split left behind, where each plant stands - is worked out in the serialiser
 * and rides on every answer here, so that no client counts days for itself.
 *
 * The needs are the checklist of what a membership widens: reading is `view`,
 * changing the grow or what is in it is `manage`, and only deleting it is `own`.
 * A plant is not among the things the record says an owner alone may delete - a
 * space, a grow and a camera are - so removing one is managing the grow.
 */
const growListQuery = pageQuery.extend({ spaceId: z.string().optional().describe('Only the grows standing in this space.') });

@ApiTags('grows')
@Controller('v1/grows')
export class GrowsController {
  constructor(private readonly grows: GrowsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The grows this account can see' })
  @V1Answer(growPage)
  public list(@Caller() ctx: AccessContext, @V1Query(growListQuery) query: z.infer<typeof growListQuery>): Promise<GrowPage> {
    return this.grows.list(ctx, query, query.spaceId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Start a grow' })
  @V1Answer(growListItem, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(growCreate) body: GrowCreate): Promise<GrowListItem> {
    return this.grows.create(ctx, body);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'One grow' })
  @V1Answer(growListItem)
  public async read(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<GrowListItem> {
    return this.grows.read(id, await this.grows.redaction(grant));
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'grow')
  @ApiOperation({ summary: 'Rename a grow, end it, or change what it is fed' })
  @V1Answer(growListItem)
  public async update(@CurrentGrant() grant: Grant, @Param('id') id: string, @V1Body(growUpdate) body: GrowUpdate): Promise<GrowListItem> {
    return this.grows.update(id, body, await this.grows.redaction(grant));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'grow')
  @ApiOperation({ summary: 'Delete a grow and its plants' })
  @ApiNoContentResponse({ description: 'The grow is gone, plants included.' })
  public remove(@Param('id') id: string): Promise<void> {
    return this.grows.remove(id);
  }

  @Get(':id/plants')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'grow')
  @ApiOperation({ summary: 'The plants of a grow' })
  @V1Answer(plantPage)
  public async plants(@CurrentGrant() grant: Grant, @Param('id') id: string): Promise<PlantPage> {
    return this.grows.listPlants(id, await this.grows.redaction(grant));
  }

  /** One plant, which is what replaces a dead one; a whole row of the new-grow sheet is created with the grow. */
  @Post(':id/plants')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'grow')
  @ApiOperation({ summary: 'Add a plant to a grow' })
  @V1Answer(plantShape, { status: HttpStatus.CREATED })
  public async addPlant(@CurrentGrant() grant: Grant, @Param('id') id: string, @V1Body(plantCreate) body: PlantCreate): Promise<Plant> {
    return this.grows.addPlant(id, body, await this.grows.redaction(grant));
  }

  /**
   * The stage picker. It writes the same phase the plan writes, through the same
   * writer, so the day counter and the "auto" tag cannot come out differently
   * depending on who moved the grow on.
   */
  @Post(':id/phases')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'grow')
  @ApiOperation({ summary: 'Put a grow, or some of its plants, into a phase' })
  @V1Answer(phaseShape, { status: HttpStatus.CREATED })
  public async addPhase(
    @Caller() ctx: AccessContext,
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Body(phaseCreate) body: PhaseCreate,
  ): Promise<Phase> {
    return this.grows.addPhase(id, body, ctx.userId, await this.grows.redaction(grant));
  }

  @Post(':id/placements')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'grow')
  @ApiOperation({ summary: 'Move a grow, or some of its plants, somewhere else' })
  @V1Answer(placementShape, { status: HttpStatus.CREATED })
  public async addPlacement(
    @Caller() ctx: AccessContext,
    @CurrentGrant() grant: Grant,
    @Param('id') id: string,
    @V1Body(placementCreate) body: PlacementCreate,
  ): Promise<Placement> {
    return this.grows.addPlacement(ctx, id, body, ctx.userId, await this.grows.redaction(grant));
  }
}
