import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Entry, TaskCompletionCreate, TaskPage } from '@fg2/shared-types/v1';
import { entry as entryShape, taskCompletionCreate, taskPage } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { pageLimit } from '@common/v1/pages';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { TaskCompletionsService } from './task-completions.service';
import { TasksService } from './tasks.service';

/**
 * What is waiting to be done, and ticking one of them off.
 *
 * A task is derived on every read and stored nowhere, so there is no resource
 * to read by id: its id is deterministic, and the completion is the entry that
 * carries it.
 */

/** `true` and `false` are words in a query string, and every non-empty word is a truthy boolean. */
const taskQuery = pageQuery.extend({
  growId: z.string().optional(),
  spaceId: z.string().optional(),
  assigneeId: z.string().optional(),
  done: z.enum(['true', 'false']).optional(),
});

type TaskQuery = z.infer<typeof taskQuery>;

@ApiTags('diary')
@Controller('v1/tasks')
export class TasksController {
  constructor(
    private readonly completions: TaskCompletionsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'What is due, the most overdue first' })
  @V1Answer(taskPage)
  public list(@V1Query(taskQuery) query: TaskQuery, @Caller() caller: AccessContext): Promise<TaskPage> {
    const filter = { growId: query.growId, spaceId: query.spaceId, assigneeId: query.assigneeId, done: query.done === 'true' };

    return this.tasks.list(caller, filter, pageLimit(query.limit), query.cursor);
  }

  @Post(':id/completions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Mark a task done, which writes the entry it implies' })
  @V1Answer(entryShape, { status: HttpStatus.CREATED, description: 'The diary line the tick wrote, which is what keeps the task from coming back.' })
  public complete(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(taskCompletionCreate) body: TaskCompletionCreate): Promise<Entry> {
    return this.completions.complete(ctx, id, body);
  }
}
