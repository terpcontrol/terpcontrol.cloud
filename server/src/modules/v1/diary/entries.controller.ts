import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { EntryPage } from '@fg2/shared-types/v1';
import { entryKind, entryPage } from '@fg2/shared-types/v1-schemas';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { V1Answer } from '../answer-shape';
import { EntriesService } from './entries.service';

/**
 * The timeline.
 *
 * Reading it is one route, whatever screen is asking: the grow page's week
 * cards, a tent's timeline, one device's log and one plant's history are the
 * same rows under a different scope. Writing one is the logging round's, so
 * this is a read and nothing else.
 *
 * The scope is what the decision is made about, so exactly one is required and
 * the guard is not the path-parameter one: `AccessService` is asked about the
 * grow, space, device or plant the query names. A share link reaches this route
 * as well as a session - the link is the whole identity a stranger has - and the
 * window it was given is what the answer is clamped to.
 */
const entryListQuery = pageQuery.extend({
  growId: z.string().optional().describe('The diary of one grow.'),
  spaceId: z.string().optional().describe('What happened in one space, its devices’ own lines included.'),
  deviceId: z.string().optional().describe('One device’s log.'),
  plantId: z.string().optional().describe('Everything logged about one plant.'),
  startsAt: z.iso.datetime().optional().describe('Narrowed further where a share link allows less.'),
  endsAt: z.iso.datetime().optional(),
  kinds: z
    .string()
    .optional()
    .describe(`Comma-separated; one or more of ${entryKind.options.join(', ')}. Absent is every kind.`),
});

@ApiTags('diary')
@Controller('v1/entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  @UseGuards(OptionalSessionGuard)
  @ApiOperation({ summary: 'The timeline of one grow, space, device or plant, newest first' })
  @V1Answer(entryPage)
  public list(@Caller() ctx: AccessContext, @V1Query(entryListQuery) query: z.infer<typeof entryListQuery>): Promise<EntryPage> {
    return this.entries.list(ctx, query);
  }
}
