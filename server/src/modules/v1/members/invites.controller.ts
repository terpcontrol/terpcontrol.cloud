import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Invite, InviteAcceptance, InviteCreate, InvitePage, InvitePreview } from '@fg2/shared-types/v1';
import { invite as inviteShape, inviteAcceptance, inviteCreate, invitePage, invitePreview } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { RateLimitGuard, RateLimited } from '@common/rate-limit.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { PUBLIC_OPERATION } from '../../../openapi';
import { V1Answer } from '../answer-shape';
import { InvitesService } from './invites.service';

/**
 * The codes a space hands out, and the two routes that redeem one.
 *
 * They are split over two controllers because they are addressed differently:
 * making and listing name the space, and the guard decides them as everything
 * else about a space is decided, while revoking, deleting, previewing and
 * accepting name the code - which is the whole proof of the invitation and is
 * only known once it has been read, so the service asks `access()` itself.
 *
 * All four routes addressed by the code are capped per address: a code is 8
 * characters out of an alphabet of 29, which is only out of reach as long as
 * guesses cannot be made quickly. The preview and the acceptance are the ones a
 * stranger reaches without an account, but revoking and deleting are reachable
 * by any account at all and answer about the same string, so an uncapped one of
 * them would be the budget the other two are held to, handed back.
 */

const MINUTE = 60 * 1000;

/**
 * Opening a link that was sent is one request, a page reloaded a few times is a
 * handful, and a host putting a key out of action is fewer still - so the three
 * routes that answer about a code without redeeming it share one budget.
 */
const CODE_LOOKUPS_PER_MINUTE = 30;

/** Joining is a deliberate act and happens once. What the budget is for is the guessing. */
const ACCEPTANCES_PER_MINUTE = 10;

@ApiTags('members')
@Controller('v1/spaces/:id/invites')
@UseGuards(AuthGuard, AccessGuard)
export class SpaceInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  @Requires('own', 'space')
  @ApiOperation({ summary: 'The invites out on this space' })
  @V1Answer(invitePage)
  public list(@Param('id') id: string, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<InvitePage> {
    return this.invites.list(id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Requires('own', 'space')
  @ApiOperation({ summary: 'Make a link into this space' })
  @V1Answer(inviteShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(inviteCreate) body: InviteCreate): Promise<Invite> {
    return this.invites.create(ctx, id, body);
  }
}

@ApiTags('members')
@Controller('v1/invites')
@UseGuards(RateLimitGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /**
   * What the person who was sent the link sees before they have an account. It
   * has no auth guard because there is nothing to authenticate: the code is the
   * whole of the request.
   */
  @Get(':code')
  @RateLimited({ limit: CODE_LOOKUPS_PER_MINUTE, windowMs: MINUTE, message: 'Too many invite lookups, please try again later.' })
  @ApiOperation({ summary: 'What an invite code leads to', ...PUBLIC_OPERATION })
  @V1Answer(invitePreview)
  public preview(@Param('code') code: string): Promise<InvitePreview> {
    return this.invites.preview(code);
  }

  @Post(':code/acceptances')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @RateLimited({ limit: ACCEPTANCES_PER_MINUTE, windowMs: MINUTE, message: 'Too many attempts to join, please try again later.' })
  @ApiOperation({ summary: 'Take up an invitation' })
  @V1Answer(inviteAcceptance, { status: HttpStatus.CREATED })
  public accept(@Caller() ctx: AccessContext, @Param('code') code: string): Promise<InviteAcceptance> {
    return this.invites.accept(ctx, code);
  }

  @Put(':code/revocation')
  @UseGuards(AuthGuard)
  @RateLimited({ limit: CODE_LOOKUPS_PER_MINUTE, windowMs: MINUTE, message: 'Too many invite lookups, please try again later.' })
  @ApiOperation({ summary: 'Stop an invite working' })
  @V1Answer(inviteShape)
  public revoke(@Caller() ctx: AccessContext, @Param('code') code: string): Promise<Invite> {
    return this.invites.revoke(ctx, code);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @RateLimited({ limit: CODE_LOOKUPS_PER_MINUTE, windowMs: MINUTE, message: 'Too many invite lookups, please try again later.' })
  @ApiOperation({ summary: 'Forget an invite ever existed' })
  @ApiNoContentResponse({ description: 'The code is gone from the list and leads nowhere.' })
  public remove(@Caller() ctx: AccessContext, @Param('code') code: string): Promise<void> {
    return this.invites.remove(ctx, code);
  }
}
