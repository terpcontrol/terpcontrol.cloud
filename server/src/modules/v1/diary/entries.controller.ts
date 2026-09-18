import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Entry, EntryCreate, EntryPage, EntryUpdate } from '@fg2/shared-types/v1';
import { entry as entryShape, entryCreate, entryKind, entryPage, entryUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Query, pageQuery } from '@common/v1/validation';
import { OptionalSessionGuard } from '@modules/v1/camera/optional-session.guard';
import { V1Answer } from '../answer-shape';
import { EntriesService } from './entries.service';
import { EntryWritesService } from './entry-writes.service';

/**
 * The timeline: read and written.
 *
 * One route each way, whatever screen is asking. Reading, because the grow
 * page's week cards, a tent's timeline, one device's log and one plant's history
 * are the same rows under a different scope. Writing, because the eight tiles of
 * the Log sheet are the same row under a different `kind`.
 *
 * Neither uses the path-parameter guard: what a read is about is its scope and
 * what a write is about is everything it names, so `AccessService` is asked
 * directly - `view` for the read, `log` for the write. A share link reaches the
 * read as well as a session and never carries `log`, so a stranger holding one
 * reads the diary and cannot add to it.
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
  constructor(
    private readonly entries: EntriesService,
    private readonly writes: EntryWritesService,
  ) {}

  @Get()
  @UseGuards(OptionalSessionGuard)
  @ApiOperation({ summary: 'The timeline of one grow, space, device or plant, newest first' })
  @V1Answer(entryPage)
  public list(@Caller() ctx: AccessContext, @V1Query(entryListQuery) query: z.infer<typeof entryListQuery>): Promise<EntryPage> {
    return this.entries.list(ctx, query);
  }

  /**
   * One line, of any of the kinds a person writes. It carries the moment it
   * happened, which may be earlier than now, and comes back with the instant
   * until which its author may still take it back.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Write one line of the diary' })
  @V1Answer(entryShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(entryCreate) body: EntryCreate): Promise<Entry> {
    return this.writes.create(ctx, body);
  }

  /** One line on its own, which is what a link into the diary and a card that was tapped open. */
  @Get(':id')
  @UseGuards(OptionalSessionGuard, AccessGuard)
  @Requires('view', 'entry')
  @ApiOperation({ summary: 'One line of the diary' })
  @V1Answer(entryShape)
  public read(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<Entry> {
    return this.entries.read(ctx, id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Correct one’s own line' })
  @V1Answer(entryShape)
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(entryUpdate) body: EntryUpdate): Promise<Entry> {
    return this.writes.update(ctx, id, body);
  }

  /** The Undo the sheet draws while the window is open, and a manager's removal afterwards. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Take a line back' })
  @ApiNoContentResponse({ description: 'The line is gone. Its pictures go with the next sweep if nothing else names them.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    return this.writes.remove(ctx, id);
  }
}
