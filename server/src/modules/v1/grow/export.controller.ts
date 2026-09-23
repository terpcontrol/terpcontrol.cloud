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
@ApiTags('grows')
@Controller('v1')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get('grows/:id/export')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'grow')
  @ApiOperation({ summary: 'A zip of one grow: its diary, its CSVs and its photos' })
  @V1Answer(exportAccepted, {
    status: HttpStatus.ACCEPTED,
    description: 'Queued, and polled through `GET /media/{id}`. 200 where the export is already there.',
  })
  public grow(@Caller() ctx: AccessContext, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<ExportAccepted> {
    return this.answer(reply, this.exports.ask(owner(ctx), 'grow', id));
  }

  @Get('me/export')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'A zip of everything this account has' })
  @V1Answer(exportAccepted, {
    status: HttpStatus.ACCEPTED,
    description: 'Queued, and polled through `GET /media/{id}`. 200 where the export is already there.',
  })
  public account(@Caller() ctx: AccessContext, @Res({ passthrough: true }) reply: FastifyReply): Promise<ExportAccepted> {
    return this.answer(reply, this.exports.ask(owner(ctx), 'account', null));
  }

  /** 202 for a job that was just started, 200 for one that was already there. */
  private async answer(reply: FastifyReply, work: Promise<ExportAccepted>): Promise<ExportAccepted> {
    const answered = await work;
    void reply.status(answered.queued ? HttpStatus.ACCEPTED : HttpStatus.OK);

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
