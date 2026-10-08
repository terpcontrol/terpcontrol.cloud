import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Reminder, ReminderCreate, ReminderPage, ReminderUpdate } from '@fg2/shared-types/v1';
import { reminder as reminderShape, reminderCreate, reminderPage, reminderUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { RemindersService } from './reminders.service';

/**
 * The rhythms a grow or a tent is kept to.
 *
 * A reminder is read by whoever may see the place it is about and written by
 * whoever manages it: it is not a line in the diary but the arrangement that
 * puts work on everybody's card, and it outlives the person who wrote it.
 */

const reminderQuery = pageQuery.extend({
  growId: z.string().optional(),
  spaceId: z.string().optional(),
});

@ApiTags('diary')
@Controller('v1/reminders')
@UseGuards(AuthGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'The rhythms kept here, newest first' })
  @V1Answer(reminderPage)
  public list(@V1Query(reminderQuery) query: z.infer<typeof reminderQuery>, @Caller() caller: AccessContext): Promise<ReminderPage> {
    return this.reminders.list(caller, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask to be reminded of something' })
  @V1Answer(reminderShape, { status: HttpStatus.CREATED })
  public create(@V1Body(reminderCreate) body: ReminderCreate, @Caller() caller: AccessContext): Promise<Reminder> {
    return this.reminders.create(caller, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the rhythm or what it is called' })
  @V1Answer(reminderShape)
  public update(@Param('id') id: string, @V1Body(reminderUpdate) body: ReminderUpdate, @Caller() caller: AccessContext): Promise<Reminder> {
    return this.reminders.update(caller, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop being reminded' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Gone. What it already had done stays in the diary.' })
  public remove(@Param('id') id: string, @Caller() caller: AccessContext): Promise<void> {
    return this.reminders.remove(caller, id);
  }
}
