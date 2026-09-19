import { Controller, Get, HttpStatus, Inject, Param, Req, Res } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { appConfig } from '../../../config/configuration';
import { PUBLIC_OPERATION } from '../../../openapi';
import { baseUrlOf, shellHtml } from './link-card';
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
 */

const HTML = { 'text/html': { schema: { type: 'string' } } };

/**
 * Short, because a diary's day number is in the title and a scraper will
 * happily show a week-old one. Long enough that a link in a busy channel is not
 * fetched once per reader.
 */
const SHELL_CACHE_SECONDS = 300;

@ApiTags('public')
@Controller()
export class LinkShellController {
  constructor(
    private readonly pages: PublicPagesService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  @Get('g/:slug')
  @ApiOperation({ summary: 'The shareable address of a public grow diary', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'A small HTML shell with the Open Graph tags of that diary.', content: HTML })
  public async grow(@Param('slug') slug: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    // Nobody in particular is reading, which is exactly what a crawler is.
    const { grow } = await this.pages.publicGrow({ userId: null, isAdmin: false, isDemo: false, shareToken: null }, slug);

    await this.send(reply, shellHtml(await this.pages.growCard(grow, baseUrlOf(request, this.config.apiUrlExternal))));
  }

  @Get('@:handle')
  @ApiOperation({ summary: 'The shareable address of a public profile', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'A small HTML shell with the Open Graph tags of that profile.', content: HTML })
  public async user(@Param('handle') handle: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const { author, grows } = await this.pages.publicUser(handle);

    await this.send(reply, shellHtml(this.pages.userCard(author, grows, baseUrlOf(request, this.config.apiUrlExternal))));
  }

  private async send(reply: FastifyReply, html: string): Promise<void> {
    await reply.header('Content-type', 'text/html; charset=utf-8').header('Cache-Control', `public, max-age=${SHELL_CACHE_SECONDS}`).send(html);
  }
}
