import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Entry, TaskCompletionCreate } from '@fg2/shared-types/v1';
import { entry as entryShape, taskCompletionCreate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { TaskCompletionsService } from './task-completions.service';

/**
 * Ticking a task off, which is the one thing that happens *to* a task.
 *
 * A task is derived on every read and stored nowhere, so it has no resource of
 * its own to answer here: its id is deterministic, and the completion is the
 * entry that carries it. Listing the tasks themselves is the tasks round's.
 */
@ApiTags('diary')
@Controller('v1/tasks')
export class TasksController {
  constructor(private readonly completions: TaskCompletionsService) {}

  @Post(':id/completions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Mark a task done, which writes the entry it implies' })
  @V1Answer(entryShape, { status: HttpStatus.CREATED, description: 'The diary line the tick wrote, which is what keeps the task from coming back.' })
  public complete(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(taskCompletionCreate) body: TaskCompletionCreate): Promise<Entry> {
    return this.completions.complete(ctx, id, body);
  }
}
