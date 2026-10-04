import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Entry, EntryCreate, EntryValuesDraft, ReminderKind, TaskCompletionCreate } from '@fg2/shared-types/v1';
import { entryValuesDraft } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { badRequest, conflict, notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { PlanService } from '../plan/plan.service';
import { EntryWritesService } from './entry-writes.service';
import { TaskRef, parseTaskId } from './task-ids';

/**
 * Ticking a task off.
 *
 * A task is derived and has nothing of its own to store, so "done" is a diary
 * entry carrying the task's id - the same entry the person would have written by
 * hand, which is why this goes through the ordinary write and not around it. The
 * access decision, the feed's arithmetic and the visit's window are therefore
 * the same ones the Log sheet gets.
 *
 * What the entry says is the task's `defaults` unless the caller says otherwise,
 * so the Done button on a card needs no body at all.
 */

/** What a reminder of each kind implies was done. A chore has no reading to take, so it is a note. */
const ENTRY_KIND: Readonly<Record<ReminderKind, EntryCreate['kind']>> = {
  water: 'water',
  feed: 'feed',
  chore: 'note',
  custom: 'note',
};

/** Mongo says 11000 when a unique index refuses a write; the driver types it as an unknown error. */
const isDuplicateKey = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

@Injectable()
export class TaskCompletionsService {
  constructor(
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    private readonly access: AccessService,
    private readonly writes: EntryWritesService,
    private readonly plans: PlanService,
  ) {}

  public async complete(ctx: AccessContext, taskId: string, body: TaskCompletionCreate): Promise<Entry> {
    const ref = parseTaskId(taskId);

    return ref.source === 'reminder' ? this.completeReminder(ctx, taskId, ref, body) : this.completePlanStep(ctx, taskId, ref, body);
  }

  /**
   * The decision first, then whether the task is still waiting, then the line -
   * the same order the plan step follows, and for the same two reasons: a
   * stranger must learn nothing about what is due here, and a card tapped twice
   * is one instruction - the second tap comes while the first is still on its
   * way back, when the card is the only thing on screen that could have stopped
   * it and has not gone yet.
   */
  private async completeReminder(
    ctx: AccessContext,
    taskId: string,
    ref: Extract<TaskRef, { source: 'reminder' }>,
    body: TaskCompletionCreate,
  ): Promise<Entry> {
    const reminder = await this.reminders.findOne({ id: ref.reminderId }).lean<ReminderDocument>();
    if (!reminder) throw notFound('task_not_found', 'There is no task with that id.');

    await this.access.require(ctx, subjectRef(reminder.subject.type, reminder.subject.id), 'log');
    await this.requireUndone(taskId);

    const kind = ENTRY_KIND[reminder.kind];

    return this.writeOnce(ctx, {
      kind,
      taskId,
      occurredAt: body.occurredAt,
      // The reminder says what the task is about; the caller narrows it to plants.
      growId: reminder.subject.type === 'grow' ? reminder.subject.id : undefined,
      spaceId: reminder.subject.type === 'space' ? reminder.subject.id : undefined,
      plantIds: body.plantIds ?? undefined,
      // A chore's whole content is what it was called, so an empty line would
      // read as nothing having been done.
      text: body.text !== undefined ? body.text : kind === 'note' ? reminder.label : null,
      values: valuesFor(kind, body.values ?? reminder.defaults),
    });
  }

  /**
   * A plan step that was waiting is confirmed by the same tap. The decision
   * comes before the confirmation and the confirmation before the line: a
   * stranger must not move somebody's plan on and only then be refused, and a
   * task nothing is waiting for should say so rather than leave a line behind.
   *
   * The decision is `manage` and not the `log` every other tick asks for,
   * because what this tap does is not write a line: it confirms the step, which
   * ends it, starts the next one and leaves that step's targets for the
   * controller to run. That is the transition `POST /devices/{id}/plan/
   * transitions` is guarded by, and a task that reached it with `log` would be
   * the same act asked for twice and answered differently - the card is only
   * the shape the confirmation is offered in.
   */
  private async completePlanStep(
    ctx: AccessContext,
    taskId: string,
    ref: Extract<TaskRef, { source: 'plan_step' }>,
    body: TaskCompletionCreate,
  ): Promise<Entry> {
    await this.access.require(ctx, subjectRef('device', ref.deviceId), 'manage');

    const plan = await this.plans.forDevice(ref.deviceId);
    if (!plan) throw notFound('task_not_found', 'There is no task with that id.');
    requireStandingOn(plan, ref.stepIndex);

    await this.plans.transition(ref.deviceId, { kind: 'confirm' }, ctx.userId);

    return this.writeOnce(ctx, {
      kind: 'note',
      taskId,
      occurredAt: body.occurredAt,
      deviceId: ref.deviceId,
      plantIds: body.plantIds ?? undefined,
      text: body.text !== undefined ? body.text : (plan.steps[ref.stepIndex]?.name ?? null),
      values: valuesFor('note', body.values),
    });
  }

  /**
   * A task is done when a line carries its id, which is also how it stops being
   * derived. Taking that line back with Undo therefore makes the task due
   * again, and ticking it off once more is allowed.
   *
   * A read and then a write, which two ticks in the same moment both pass - so
   * the collection refuses the second itself, through the unique index on
   * `taskId`. This check stays because it is what turns the common case into an
   * answer a person can read rather than a rejected write.
   */
  /**
   * The write itself, with the collection's refusal turned into the answer the
   * check above gives: two people ticking one task at the same moment is a
   * race, not a fault of either of them, and the second should be told the
   * thing is done rather than that something went wrong.
   */
  private async writeOnce(ctx: AccessContext, entry: EntryCreate): Promise<Entry> {
    try {
      return await this.writes.create(ctx, entry);
    } catch (error) {
      if (isDuplicateKey(error)) throw conflict('task_done_already', 'That task has been ticked off already.');
      throw error;
    }
  }

  private async requireUndone(taskId: string): Promise<void> {
    const done = await this.entries.exists({ taskId });
    if (done) throw conflict('task_done_already', 'That task has been ticked off already.');
  }
}

const requireStandingOn = (plan: StoredPlan, stepIndex: number): void => {
  if (plan.state.activeStepIndex !== stepIndex) {
    throw conflict('task_moved_on', 'The plan has left the step this task was about.');
  }
};

/**
 * The values the entry is written with. `defaults` is stored as an untyped
 * object and the body's `values` arrives untyped too, so both are checked
 * against the contract here rather than believed - and a default that no longer
 * matches the kind falls back to the empty shape rather than refusing a tick.
 */
const valuesFor = (kind: EntryCreate['kind'], values: unknown): EntryValuesDraft => {
  if (values === null || values === undefined) return { kind } as EntryValuesDraft;

  const parsed = entryValuesDraft.safeParse(values);
  if (!parsed.success) {
    throw badRequest('validation_failed', 'The values a completion is written with are the entry values of its kind.', [
      { field: 'values', code: 'invalid', detail: parsed.error.issues.map(issue => issue.message).join(', ') },
    ]);
  }

  return parsed.data.kind === kind ? parsed.data : ({ kind } as EntryValuesDraft);
};
