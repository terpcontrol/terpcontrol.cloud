import { Controller, Get, HttpStatus, Param, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import type { ExportAccepted } from '@fg2/shared-types/v1';
import { exportAccepted } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { forbidden } from '@common/v1/problem';
import { V1Answer } from '../answer-shape';
import { ExportService } from './export.service';

/**
 * Taking a copy of everything: one grow, or the whole account.
 *
 * Both answer a job rather than a file, because a zip of a season with its
 * pictures in it does not finish inside a request. The job is the media row the
 * file will be, so it is polled through `GET /media/{id}` and downloaded
 * through `GET /media/{id}/content` like anything else in the bucket.
 *
 * The grow's export needs `own` rather than `view`. Everything else about a
 * grow is readable by a member, by a link and, for a public diary, by a
 * stranger, each of them narrowed to what they were granted; an export is
 * narrowed to nothing at all, so the only person it can be answered to is the
 * one whose grow it is. A demo session owns nothing and therefore exports
 * nothing.
 */
const BUILDING =
  'Not ready yet: queued by this request (`queued` is true), or already queued or being built by an earlier one. Polled through `GET /media/{id}` until `exportJob.status` is `ready`.';
const READY = 'The export is already there and finished: `exportJob.status` is `ready`, and its bytes come from `GET /media/{id}/content`.';

@ApiTags('grows')
@Controller('v1')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get('grows/:id/export')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'grow')
  @ApiOperation({ summary: 'A zip of one grow: its diary, its CSVs and its photos' })
  @V1Answer(exportAccepted, { status: HttpStatus.ACCEPTED, description: BUILDING })
  @V1Answer(exportAccepted, { status: HttpStatus.OK, description: READY })
  public grow(@Caller() ctx: AccessContext, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<ExportAccepted> {
    return this.answer(reply, this.exports.ask(owner(ctx), 'grow', id));
  }

  @Get('me/export')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'A zip of everything this account has' })
  @V1Answer(exportAccepted, { status: HttpStatus.ACCEPTED, description: BUILDING })
  @V1Answer(exportAccepted, { status: HttpStatus.OK, description: READY })
  public account(@Caller() ctx: AccessContext, @Res({ passthrough: true }) reply: FastifyReply): Promise<ExportAccepted> {
    return this.answer(reply, this.exports.ask(owner(ctx), 'account', null));
  }

  /**
   * 200 for a file that can be downloaded, 202 for everything that is still to
   * be waited for. A second ask while the first build is queued or running
   * answers that same build - and answered 200, it read as a finished file to
   * a client that took the status at its word, which then downloaded nothing.
   */
  private async answer(reply: FastifyReply, work: Promise<ExportAccepted>): Promise<ExportAccepted> {
    const answered = await work;
    void reply.status(answered.media.exportJob?.status === 'ready' ? HttpStatus.OK : HttpStatus.ACCEPTED);

    return answered;
  }
}

/**
 * Whose export it is. A demo session is a tour rather than an account: it has a
 * user id and owns nothing behind it, so an export of "everything it can see"
 * would be an export of somebody else's demo grow.
 */
const owner = (ctx: AccessContext): string => {
  if (ctx.isDemo || ctx.userId === null) {
    throw forbidden('demo_session', "A demo session is a tour of somebody else's grow and has nothing of its own to export.");
  }

  return ctx.userId;
};
