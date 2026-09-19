import { Controller, Get, HttpStatus, Inject, Param, Res, UseGuards } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { RateLimited, RateLimitGuard } from '@common/rate-limit.guard';
import { appConfig } from '../../../config/configuration';
import { PUBLIC_OPERATION } from '../../../openapi';
import { SHELL_CACHE_SECONDS, baseUrlOf, shellHtml } from './link-card';
import { PublicPagesService } from './public-pages.service';

/**
 * The two addresses a person actually shares: `/g/{slug}` for a diary and
 * `/@{handle}` for its author.
 *
 * They sit outside `/v1` because they are not API routes: they are what gets
 * pasted into a message, and what a crawler fetches to draw a preview of it. So
 * each answers a small HTML shell whose Open Graph tags come from the same
 * `LinkCard` that `card.png` is drawn from - the tags and the picture cannot
 * disagree, because there is only one of them.
 *
 * Each carries a budget, as the routes under `/v1/public` do: these are the two
 * addresses that get pasted about, so they are the two that get hammered.
 */

const HTML = { 'text/html': { schema: { type: 'string' } } };

const MINUTE = 60 * 1000;

@ApiTags('public')
@Controller()
@UseGuards(RateLimitGuard)
export class LinkShellController {
  constructor(
    private readonly pages: PublicPagesService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  @Get('g/:slug')
  @RateLimited({ limit: 60, windowMs: MINUTE, message: 'Too many requests for shared diaries, please try again later.' })
  @ApiOperation({ summary: 'The shareable address of a public grow diary', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'A small HTML shell with the Open Graph tags of that diary.', content: HTML })
  public async grow(@Param('slug') slug: string, @Res() reply: FastifyReply): Promise<void> {
    // Nobody in particular is reading, which is exactly what a crawler is.
    const { grow } = await this.pages.publicGrow({ userId: null, isAdmin: false, isDemo: false, shareToken: null }, slug);

    await this.send(reply, shellHtml(await this.pages.growCard(grow, baseUrlOf(this.config.apiUrlExternal))));
  }

  @Get('@:handle')
  @RateLimited({ limit: 60, windowMs: MINUTE, message: 'Too many requests for public profiles, please try again later.' })
  @ApiOperation({ summary: 'The shareable address of a public profile', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'A small HTML shell with the Open Graph tags of that profile.', content: HTML })
  public async user(@Param('handle') handle: string, @Res() reply: FastifyReply): Promise<void> {
    const { author, grows } = await this.pages.publicUser(handle);

    await this.send(reply, shellHtml(this.pages.userCard(author, grows, baseUrlOf(this.config.apiUrlExternal))));
  }

  private async send(reply: FastifyReply, html: string): Promise<void> {
    await reply.header('Content-type', 'text/html; charset=utf-8').header('Cache-Control', `public, max-age=${SHELL_CACHE_SECONDS}`).send(html);
  }
}
