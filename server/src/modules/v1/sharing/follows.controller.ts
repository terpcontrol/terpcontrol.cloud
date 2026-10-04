import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Follow, FollowPage } from '@fg2/shared-types/v1';
import { follow as followShape, followPage } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Answer } from '../answer-shape';
import { FollowsService } from './follows.service';

/**
 * The grows this account follows.
 *
 * Both writing routes are about one grow named in the path and carry no body,
 * because a follow has nothing else to say. The grow is not the subject of the
 * route in the guard's sense either: what is being written is the caller's own
 * follow, and whether they may see the grow at all is asked inside.
 */
@ApiTags('sharing')
@Controller('v1/follows')
@UseGuards(AuthGuard)
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get()
  @ApiOperation({ summary: 'The grows this account follows' })
  @V1Answer(followPage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<FollowPage> {
    return this.follows.list(ctx, query);
  }

  @Put(':growId')
  @ApiOperation({ summary: 'Follow a public grow' })
  @V1Answer(followShape)
  public follow(@Caller() ctx: AccessContext, @Param('growId') growId: string): Promise<Follow> {
    return this.follows.follow(ctx, growId);
  }

  @Delete(':growId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop following a grow' })
  @ApiNoContentResponse({ description: 'The grow is off the home screen, whether or not it was ever followed.' })
  public unfollow(@Caller() ctx: AccessContext, @Param('growId') growId: string): Promise<void> {
    return this.follows.unfollow(ctx, growId);
  }
}
