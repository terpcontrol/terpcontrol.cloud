import { Controller, Get, HttpStatus, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GrowWeekCard, PublicGrowPage, PublicUserPage, SharedResolution } from '@fg2/shared-types/v1';
import { publicGrowPage, publicUserPage, publicWeekPage, sharedResolution } from '@fg2/shared-types/v1-schemas';
import { RateLimited, RateLimitGuard } from '@common/rate-limit.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage } from '@common/v1/pages';
import { V1Query, pageQuery } from '@common/v1/validation';
import { parseDimension } from '@modules/v1/camera/media-presentation.service';
import { MediaDeliveryService } from '@modules/v1/camera/media-delivery.service';
import { appConfig } from '../../../config/configuration';
import { PUBLIC_OPERATION } from '../../../openapi';
import { V1Answer } from '../answer-shape';
import { CARD_CACHE_SECONDS, CARD_HEIGHT, CARD_WIDTH, CardCache, baseUrlOf, renderCard } from './link-card';
import { PublicPagesService } from './public-pages.service';

/**
 * What somebody who is not signed in can read: a diary its grower made public,
 * the diaries of a person who published a profile, and the picture a chat
 * window draws for either.
 *
 * None of these routes has an auth guard on it, because there is nothing to
 * authenticate: the address is the whole of the request. What may be seen is
 * still `access()`'s decision - a public grow is granted `view` for as long as
 * it ran, and every read below is clamped to that.
 *
 * What they do carry is a budget each. These are the only routes here that
 * anybody at all can call, and they are not cheap: resolving a link is a write
 * and up to twenty-six week cards of time-series reads, and a card is a
 * 1200x630 composite. Without one, the cost of making this server work is a
 * loop. The budgets are per address and per route, so a burst on the pictures of
 * one diary cannot shut the pages themselves.
 */

/** A rendered card is a PNG and nothing else. */
const CARD_BYTES = { 'image/png': { schema: { type: 'string', format: 'binary' } } };

const PICTURE_BYTES = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
};

const MINUTE = 60 * 1000;

/**
 * A page of a whole grow draws one thumbnail per day of up to twenty-six weeks,
 * so a single reader scrolling one diary is a couple of hundred picture
 * requests. The budget has to be a page and not a screenful, or reading a long
 * diary throttles itself.
 */
const PICTURES_PER_MINUTE = 600;

@ApiTags('public')
@Controller('v1')
@UseGuards(RateLimitGuard)
export class PublicController {
  constructor(
    private readonly pages: PublicPagesService,
    private readonly delivery: MediaDeliveryService,
    private readonly cards: CardCache,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  @Get('shared/:token')
  @RateLimited({ limit: 30, windowMs: MINUTE, message: 'Too many requests for shared diaries, please try again later.' })
  @ApiOperation({ summary: 'What a share link leads to', ...PUBLIC_OPERATION })
  @V1Answer(sharedResolution)
  public resolve(@Param('token') token: string): Promise<SharedResolution> {
    return this.pages.resolve(token);
  }

  /**
   * The earlier weeks of a diary somebody was sent a link to. The page itself
   * carries the newest of them, so this is what the "earlier weeks" control
   * follows, and it is the same read under the same link - the token is the
   * whole of the request here as it is there.
   */
  @Get('shared/:token/weeks')
  @RateLimited({ limit: 30, windowMs: MINUTE, message: 'Too many requests for shared diaries, please try again later.' })
  @ApiOperation({ summary: 'The weeks before the ones a shared diary carried', ...PUBLIC_OPERATION })
  @V1Answer(publicWeekPage)
  public sharedWeeks(@Param('token') token: string, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<CursorPage<GrowWeekCard>> {
    return this.pages.sharedWeeks(token, query);
  }

  @Get('public/grows/:slug')
  @RateLimited({ limit: 30, windowMs: MINUTE, message: 'Too many requests for public diaries, please try again later.' })
  @ApiOperation({ summary: 'A public grow diary', ...PUBLIC_OPERATION })
  @V1Answer(publicGrowPage)
  public async grow(@Caller() ctx: AccessContext, @Param('slug') slug: string): Promise<PublicGrowPage> {
    const { grow, grant } = await this.pages.publicGrow(ctx, slug);
    return this.pages.growPage(grow, grant);
  }

  /**
   * The weeks before the ones the page carried, for a diary at its own address.
   *
   * A diary that ran longer than a page holds is otherwise a diary whose first
   * months have no address at all, and the page is the wrong place to grow: it
   * would mean reading the grow, its plants, its owner and its totals again for
   * every screenful. So the weeks alone are asked for, through the same grant
   * the page was built from.
   */
  @Get('public/grows/:slug/weeks')
  @RateLimited({ limit: 30, windowMs: MINUTE, message: 'Too many requests for public diaries, please try again later.' })
  @ApiOperation({ summary: 'The weeks before the ones a public diary carried', ...PUBLIC_OPERATION })
  @V1Answer(publicWeekPage)
  public async weeks(
    @Caller() ctx: AccessContext,
    @Param('slug') slug: string,
    @V1Query(pageQuery) query: z.infer<typeof pageQuery>,
  ): Promise<CursorPage<GrowWeekCard>> {
    const { grow, grant } = await this.pages.publicGrow(ctx, slug);
    return this.pages.weeksPage(grow, grant, query);
  }

  /**
   * A picture of that grow, and of no other. The generic media route cannot
   * answer this one: a camera's still belongs to a camera rather than to a grow,
   * so what makes it public is the grow it was taken in - which only this route
   * knows, because the grow is in its path.
   */
  @Get('public/grows/:slug/media/:id')
  @RateLimited({ limit: PICTURES_PER_MINUTE, windowMs: MINUTE, message: 'Too many pictures asked for, please try again later.' })
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

    return this.delivery.deliver(
      request,
      reply,
      picture,
      { width: parseDimension(query.width), height: parseDimension(query.height) },
      grant.redacted,
    );
  }

  @Get('public/grows/:slug/card.png')
  @RateLimited({ limit: 60, windowMs: MINUTE, message: 'Too many cards asked for, please try again later.' })
  @ApiOperation({ summary: 'The share card of a public grow', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: `The card, ${CARD_WIDTH}x${CARD_HEIGHT}.`, content: CARD_BYTES })
  public async growCard(@Caller() ctx: AccessContext, @Param('slug') slug: string, @Res() reply: FastifyReply): Promise<void> {
    // The decision first and every time, so that a grow gone private stops
    // answering at once whatever the cache still holds of it.
    const { grow } = await this.pages.publicGrow(ctx, slug);
    const png = await this.cards.of(`grow:${grow.id}`, async () => {
      const card = await this.pages.growCard(grow, baseUrlOf(this.config.apiUrlExternal));
      return renderCard(card, await this.pages.bytesOf(grow.coverMediaId));
    });

    await this.sendCard(reply, png);
  }

  @Get('public/users/:handle')
  @RateLimited({ limit: 30, windowMs: MINUTE, message: 'Too many requests for public profiles, please try again later.' })
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
  @RateLimited({ limit: 60, windowMs: MINUTE, message: 'Too many cards asked for, please try again later.' })
  @ApiOperation({ summary: 'The share card of a public profile', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: `The card, ${CARD_WIDTH}x${CARD_HEIGHT}.`, content: CARD_BYTES })
  public async userCard(@Param('handle') handle: string, @Res() reply: FastifyReply): Promise<void> {
    const { author, grows } = await this.pages.publicUser(handle);
    const png = await this.cards.of(`user:${author.id}`, () => {
      const card = this.pages.userCard(author, grows, baseUrlOf(this.config.apiUrlExternal));

      // Somebody's newest cover stands for their profile; a person with no
      // picture anywhere gets the panel the app is drawn on.
      return this.pages.bytesOf(this.pages.coverOf(grows)).then(cover => renderCard(card, cover));
    });

    await this.sendCard(reply, png);
  }

  private async sendCard(reply: FastifyReply, png: Buffer): Promise<void> {
    await reply.header('Content-type', 'image/png').header('Cache-Control', `public, max-age=${CARD_CACHE_SECONDS}`).send(png);
  }
}
