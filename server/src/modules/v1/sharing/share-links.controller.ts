import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ShareLink, ShareLinkCreate, ShareLinkPage, ShareLinkUpdate } from '@fg2/shared-types/v1';
import { shareLink as shareLinkShape, shareLinkCreate, shareLinkPage, shareLinkUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { ShareLinksService } from './share-links.service';

/**
 * The links somebody has handed out.
 *
 * Every route here is about a link rather than about what it points at, so none
 * of them can declare its need with the guard: the subject is inside the link
 * and is only known once it has been read. The service asks `access()` about
 * that subject instead, and it asks for `own` - making a key to somebody's
 * diary, changing it and ending it are the owner's.
 *
 * The token is on the wire here, because handing the link out is the point of
 * it. It is never on the wire through the link.
 */
@ApiTags('sharing')
@Controller('v1/share-links')
@UseGuards(AuthGuard)
export class ShareLinksController {
  constructor(private readonly links: ShareLinksService) {}

  @Get()
  @ApiOperation({ summary: 'The share links of this account' })
  @V1Answer(shareLinkPage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<ShareLinkPage> {
    return this.links.list(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Make a link onto a grow or a space' })
  @V1Answer(shareLinkShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(shareLinkCreate) body: ShareLinkCreate): Promise<ShareLink> {
    return this.links.create(ctx, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a link that is already out of the house' })
  @V1Answer(shareLinkShape)
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(shareLinkUpdate) body: ShareLinkUpdate): Promise<ShareLink> {
    return this.links.update(ctx, id, body);
  }

  /** Ending a link is not a deletion, which is why it is a noun of its own. */
  @Put(':id/revocation')
  @ApiOperation({ summary: 'Stop a link working' })
  @V1Answer(shareLinkShape)
  public revoke(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<ShareLink> {
    return this.links.revoke(ctx, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Forget a link that has stopped' })
  @ApiNoContentResponse({ description: 'The link is gone from the list. A link that still works is refused with 409: it is revoked first.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    return this.links.remove(ctx, id);
  }
}
