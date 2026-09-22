import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Membership, MembershipCreate, MembershipPage, MembershipUpdate } from '@fg2/shared-types/v1';
import { membership as membershipShape, membershipCreate, membershipPage, membershipUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, CurrentGrant, Requires } from '@common/v1/access.guard';
import { AccessContext, Grant } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { MembersService } from './members.service';

/**
 * Who is in a space besides its owner.
 *
 * Reading the list takes `view`, because the board draws it to everybody who is
 * in the tent and a member who cannot see who else is there cannot tell whose
 * entry they are reading. The list narrows that further on its own: `view` is
 * also what a share link grants, and a key to a diary is not a key to the guest
 * list.
 *
 * Adding, changing a role and removing take `own`. A manager runs the tent, and
 * handing out the way in is the one thing that is not running it. The exception
 * is a member removing themselves, which is why the delete asks the guard only
 * for `view` and the service makes the rest of that decision - somebody who was
 * let in has to be able to walk back out without asking.
 */
@ApiTags('members')
@Controller('v1/spaces/:id/members')
@UseGuards(AuthGuard, AccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Requires('view', 'space')
  @ApiOperation({ summary: 'Who is in this space' })
  @V1Answer(membershipPage)
  public list(@Param('id') id: string, @CurrentGrant() grant: Grant, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<MembershipPage> {
    return this.members.list(id, grant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Requires('own', 'space')
  @ApiOperation({ summary: 'Put somebody you already grow with into this space' })
  @V1Answer(membershipShape, { status: HttpStatus.CREATED })
  public add(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(membershipCreate) body: MembershipCreate): Promise<Membership> {
    return this.members.add(ctx, id, body);
  }

  @Patch(':userId')
  @Requires('own', 'space')
  @ApiOperation({ summary: 'Change what somebody may do here' })
  @V1Answer(membershipShape)
  public update(@Param('id') id: string, @Param('userId') userId: string, @V1Body(membershipUpdate) body: MembershipUpdate): Promise<Membership> {
    return this.members.update(id, userId, body);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requires('view', 'space')
  @ApiOperation({ summary: 'Let somebody go, or leave' })
  @ApiNoContentResponse({ description: 'The space is gone from their lists; whatever they wrote in it stays and still carries their name.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string, @Param('userId') userId: string): Promise<void> {
    return this.members.remove(ctx, id, userId);
  }
}
