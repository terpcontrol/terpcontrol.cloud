import { Controller, Get, HttpStatus, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import type { PublicGrowPage, PublicUserPage, SharedResolution } from '@fg2/shared-types/v1';
import { publicGrowPage, publicUserPage, sharedResolution } from '@fg2/shared-types/v1-schemas';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { parseDimension } from '@modules/v1/camera/media-presentation.service';
import { MediaDeliveryService } from '@modules/v1/camera/media-delivery.service';
import { appConfig } from '../../../config/configuration';
import { PUBLIC_OPERATION } from '../../../openapi';
import { V1Answer } from '../answer-shape';
import { CARD_HEIGHT, CARD_WIDTH, baseUrlOf, renderCard } from './link-card';
import { PublicPagesService } from './public-pages.service';

/**
 * What somebody who is not signed in can read: a diary its grower made public,
 * the diaries of a person who published a profile, and the picture a chat
 * window draws for either.
 *
 * None of these routes has a guard on it, because there is nothing to
 * authenticate: the address is the whole of the request. What may be seen is
 * still `access()`'s decision - a public grow is granted `view` for as long as
 * it ran, and every read below is clamped to that.
 */

/** A rendered card is a PNG and nothing else. */
const CARD_BYTES = { 'image/png': { schema: { type: 'string', format: 'binary' } } };

const PICTURE_BYTES = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
};

/**
 * A card changes as a grow does, and a chat window caches whatever it is given
 * for as long as it is told to. An hour is short enough that a card fetched
 * again tomorrow says today's day number, and long enough that a link pasted
 * into a busy channel is rendered once.
 */
const CARD_CACHE_SECONDS = 3600;

@ApiTags('public')
@Controller('v1')
export class PublicController {
  constructor(
    private readonly pages: PublicPagesService,
    private readonly delivery: MediaDeliveryService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  @Get('shared/:token')
  @ApiOperation({ summary: 'What a share link leads to', ...PUBLIC_OPERATION })
  @V1Answer(sharedResolution)
  public resolve(@Param('token') token: string): Promise<SharedResolution> {
    return this.pages.resolve(token);
  }

  @Get('public/grows/:slug')
  @ApiOperation({ summary: 'A public grow diary', ...PUBLIC_OPERATION })
  @V1Answer(publicGrowPage)
  public async grow(@Caller() ctx: AccessContext, @Param('slug') slug: string): Promise<PublicGrowPage> {
    const { grow, grant } = await this.pages.publicGrow(ctx, slug);
    return this.pages.growPage(grow, grant);
  }

  /**
   * A picture of that grow, and of no other. The generic media route cannot
   * answer this one: a camera's still belongs to a camera rather than to a grow,
   * so what makes it public is the grow it was taken in - which only this route
   * knows, because the grow is in its path.
   */
  @Get('public/grows/:slug/media/:id')
  @ApiQuery({ name: 'width', required: false, description: 'A thumbnail rather than the whole picture. Never enlarged.' })
  @ApiQuery({ name: 'height', required: false })
  @ApiOperation({ summary: 'A picture of a public grow', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'The file itself, in the type it was stored as.', content: PICTURE_BYTES })
  @ApiResponse({ status: HttpStatus.PARTIAL_CONTENT, description: 'The byte range a <video> element asked for.', content: PICTURE_BYTES })
  public async picture(
    @Caller() ctx: AccessContext,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Query() query: { width?: string; height?: string },
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { grow, grant } = await this.pages.publicGrow(ctx, slug);
    const picture = await this.pages.pictureOf(grow, grant, id);

    return this.delivery.deliver(request, reply, picture, { width: parseDimension(query.width), height: parseDimension(query.height) });
  }

  @Get('public/grows/:slug/card.png')
  @ApiOperation({ summary: 'The share card of a public grow', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: `The card, ${CARD_WIDTH}x${CARD_HEIGHT}.`, content: CARD_BYTES })
  public async growCard(
    @Caller() ctx: AccessContext,
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { grow } = await this.pages.publicGrow(ctx, slug);
    const card = await this.pages.growCard(grow, baseUrlOf(request, this.config.apiUrlExternal));

    await this.sendCard(reply, await renderCard(card, await this.pages.bytesOf(grow.coverMediaId)));
  }

  @Get('public/users/:handle')
  @ApiOperation({ summary: 'The public diaries of one person', ...PUBLIC_OPERATION })
  @V1Answer(publicUserPage)
  public async user(@Param('handle') handle: string): Promise<PublicUserPage> {
    const { author, grows } = await this.pages.publicUser(handle);
    return this.pages.userPage(author, grows);
  }

  /**
   * A profile's card. The route table of the record names only the grow's, but
   * `/@{handle}` needs an `og:image` of its own and the shell is built from the
   * same `LinkCard` the picture is - a shell whose picture came from somewhere
   * else is exactly what that shape exists to prevent.
   */
  @Get('public/users/:handle/card.png')
  @ApiOperation({ summary: 'The share card of a public profile', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: `The card, ${CARD_WIDTH}x${CARD_HEIGHT}.`, content: CARD_BYTES })
  public async userCard(@Param('handle') handle: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const { author, grows } = await this.pages.publicUser(handle);
    const card = this.pages.userCard(author, grows, baseUrlOf(request, this.config.apiUrlExternal));

    // Somebody's newest cover stands for their profile; a person with no picture
    // anywhere gets the panel the app is drawn on.
    await this.sendCard(reply, await renderCard(card, await this.pages.bytesOf(this.pages.coverOf(grows))));
  }

  private async sendCard(reply: FastifyReply, png: Buffer): Promise<void> {
    await reply.header('Content-type', 'image/png').header('Cache-Control', `public, max-age=${CARD_CACHE_SECONDS}`).send(png);
  }
}
