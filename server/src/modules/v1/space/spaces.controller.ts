import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Device, Space, SpaceCreate, SpaceLive, SpacePage, SpaceUpdate } from '@fg2/shared-types/v1';
import { device as deviceShape, space as spaceShape, spaceCreate, spaceLive, spacePage, spaceUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { SpaceLiveService } from './space-live.service';
import { SpacesService } from './spaces.service';

/**
 * A space, and what stands in it.
 *
 * Every route but the list and the creation is about one space and says what it
 * needs of the caller: a member reads a space, a manager changes it, and only
 * the owner ends one. Ending is a route of its own in both flavours - archiving
 * a place that is not in use, and deleting one - so that neither is something a
 * settings form does in passing.
 */

/** A query string carries a flag as text, so it is read as the two words it can be. */
const spaceListQuery = pageQuery.extend({
  roomId: z.string().optional().describe('Only the spaces grouped by this room.'),
  archived: z.enum(['true', 'false']).optional().describe('`true` lists the spaces that have been archived instead of the ones in use.'),
});

@ApiTags('spaces')
@Controller('v1/spaces')
export class SpacesController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly live: SpaceLiveService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The spaces this account can see' })
  @V1Answer(spacePage)
  public list(@Caller() ctx: AccessContext, @V1Query(spaceListQuery) query: z.infer<typeof spaceListQuery>): Promise<SpacePage> {
    return this.spaces.list(ctx, query, { roomId: query.roomId, archived: query.archived === 'true' });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Make a space' })
  @V1Answer(spaceShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(spaceCreate) body: SpaceCreate): Promise<Space> {
    return this.spaces.create(ctx, body);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({ summary: 'One space' })
  @V1Answer(spaceShape)
  public async read(@Param('id') id: string): Promise<Space> {
    return this.spaces.serialise(await this.spaces.require(id));
  }

  @Get(':id/live')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'space')
  @ApiOperation({ summary: 'The newest reading of everything in this space, with its age' })
  @V1Answer(spaceLive)
  public async readLive(@Param('id') id: string): Promise<SpaceLive> {
    await this.spaces.require(id);
    return this.live.liveOf(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'space')
  @ApiOperation({ summary: 'Rename a space, change its kind, or group it under a room' })
  @V1Answer(spaceShape)
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(spaceUpdate) body: SpaceUpdate): Promise<Space> {
    return this.spaces.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'space')
  @ApiOperation({ summary: 'End a space' })
  @ApiNoContentResponse({ description: 'The space is gone from every list; whatever history names it still reads.' })
  public remove(@Param('id') id: string): Promise<void> {
    return this.spaces.remove(id);
  }

  @Put(':id/archive')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'space')
  @ApiOperation({ summary: 'Put a space away without ending it' })
  @V1Answer(spaceShape)
  public archive(@Param('id') id: string): Promise<Space> {
    return this.spaces.archive(id, true);
  }

  @Delete(':id/archive')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'space')
  @ApiOperation({ summary: 'Take a space back out of the archive' })
  @V1Answer(spaceShape)
  public unarchive(@Param('id') id: string): Promise<Space> {
    return this.spaces.archive(id, false);
  }

  @Put(':id/devices/:deviceId')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'space')
  @ApiOperation({ summary: 'Put a device in this space' })
  @V1Answer(deviceShape)
  public async placeDevice(@Caller() ctx: AccessContext, @Param('id') id: string, @Param('deviceId') deviceId: string): Promise<Device> {
    // Moving a device is managing two things, and the guard above has only
    // decided about the space it is being put into.
    await this.access.require(ctx, subjectRef('device', deviceId), 'manage');

    return this.spaces.placeDevice(id, deviceId, ctx.isDemo);
  }

  @Delete(':id/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'space')
  @ApiOperation({ summary: 'Take a device out of this space' })
  @ApiNoContentResponse({ description: 'The device stands nowhere until it is put somewhere else.' })
  public async removeDevice(@Caller() ctx: AccessContext, @Param('id') id: string, @Param('deviceId') deviceId: string): Promise<void> {
    await this.access.require(ctx, subjectRef('device', deviceId), 'manage');

    return this.spaces.removeDevice(id, deviceId);
  }
}
