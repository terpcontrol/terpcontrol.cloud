import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GrowOrSpaceRef, Task } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, decodeCursor, pageOf } from '@common/v1/pages';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { activeStep, durationMs, elapsedMs } from '../plan/plan-steps';
import { dueTasksOf, occurrencePrefix } from '../home/due-tasks';
import { planTaskId } from './task-ids';
import { VisibleSubjectsService } from './visible-subjects.service';

/**
 * The task list: everything that is waiting to be done, worked out on the spot.
 *
 * Nothing here is stored. A task is what a reminder's rhythm says is due and
 * what a plan step is waiting to be told, and "done" is a diary entry carrying
 * the task's id - so the list is derived on every read and there is nothing to
 * keep in sync. The cards on the home and tent screens derive the same tasks
 * from the same function; this is the list of all of them in one place.
 *
 * Two of the four sources the contract names are not derived yet. The scheme
 * grid states what to feed in a given week but never on which day, so nothing
 * in the model says when a row of it falls due - the feed reminder is what puts
 * feeding on the calendar, and the grid is what fills in its doses. A plan
 * suggestion has no shape in the model at all yet. Both wait for the round that
 * gives them one.
 */

/** How far back a task that has already been ticked off is still worth showing. */
const DONE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export interface TaskFilter {
  growId?: string;
  spaceId?: string;
  assigneeId?: string;
  /** True lists what has been ticked off recently, false and absent what is still waiting. */
  done?: boolean;
}

/** A device and the grow or space its plan's tasks belong to. */
interface Place {
  deviceId: string;
  subject: GrowOrSpaceRef;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    private readonly access: AccessService,
    private readonly visible: VisibleSubjectsService,
  ) {}

  public async list(ctx: AccessContext, filter: TaskFilter, limit: number, cursor: string | undefined, now = new Date()): Promise<CursorPage<Task>> {
    if (filter.growId) await this.access.require(ctx, subjectRef('grow', filter.growId), 'view');
    if (filter.spaceId) await this.access.require(ctx, subjectRef('space', filter.spaceId), 'view');

    const where = await this.placesOf(ctx, filter);
    if (where.spaceIds.length === 0 && where.growIds.length === 0) return { items: [], nextCursor: null };

    const reminders = await this.remindersOf(where);
    const completions = await this.completionsOf(reminders);
    const tasks = filter.done
      ? this.ticked(reminders, completions, now)
      : [...this.waiting(reminders, completions, now), ...(await this.planSteps(ctx, where, now))];

    const wanted = filter.assigneeId ? tasks.filter(task => task.assigneeId === filter.assigneeId) : tasks;

    // The most overdue first, which is the order somebody works through them.
    // The page is cut here rather than by the database: nothing in this list is
    // a row, so there is nothing to sort or skip in a query.
    const sorted = wanted.sort((one, other) => one.dueAt.localeCompare(other.dueAt) || one.id.localeCompare(other.id));

    return pageOf(after(sorted, cursor), limit, task => ({ at: new Date(task.dueAt), id: task.id }));
  }

  /** The grows and spaces the answer may be built from: the one that was named, or everything kept. */
  private async placesOf(ctx: AccessContext, filter: TaskFilter): Promise<{ spaceIds: string[]; growIds: string[] }> {
    if (filter.growId) return { spaceIds: [], growIds: [filter.growId] };
    if (filter.spaceId) return { spaceIds: [filter.spaceId], growIds: [] };

    return this.visible.workedInBy(ctx);
  }

  private remindersOf(where: { spaceIds: string[]; growIds: string[] }): Promise<ReminderDocument[]> {
    return this.reminders
      .find({
        $or: [
          { 'subject.type': 'space', 'subject.id': { $in: where.spaceIds } },
          { 'subject.type': 'grow', 'subject.id': { $in: where.growIds } },
        ],
      })
      .lean<ReminderDocument[]>();
  }

  /** The entries that ticked a task of these reminders off: a one-off by its id, a rhythm by any of its occurrences. */
  private completionsOf(reminders: ReminderDocument[]): Promise<EntryDocument[]> {
    if (reminders.length === 0) return Promise.resolve([]);

    return this.entries
      .find({ $or: reminders.map(reminder => ({ taskId: reminder.onceAt ? reminder.id : { $regex: `^${occurrencePrefix(reminder.id)}` } })) })
      .lean<EntryDocument[]>();
  }

  private waiting(reminders: ReminderDocument[], completions: EntryDocument[], now: Date): Task[] {
    const byId = new Map(reminders.map(reminder => [reminder.id, reminder]));

    return dueTasksOf(reminders, completions, now).map(due => {
      const reminder = byId.get(due.id.split(':')[0]);

      return { ...due, source: 'reminder', sourceId: reminder?.id ?? null, defaults: reminder?.defaults ?? null, done: false, completion: null };
    });
  }

  /**
   * What has been ticked off lately, so that a card can show the morning's work
   * struck through rather than simply gone. The completion is the whole record
   * of it: the entry carries the task's id, and the day the occurrence fell due
   * is in that id.
   */
  private ticked(reminders: ReminderDocument[], completions: EntryDocument[], now: Date): Task[] {
    const since = now.getTime() - DONE_WINDOW_MS;

    return completions.flatMap(entry => {
      const taskId = entry.taskId;
      if (!taskId || entry.occurredAt.getTime() < since) return [];

      const reminder = reminders.find(candidate => taskId === candidate.id || taskId.startsWith(occurrencePrefix(candidate.id)));
      if (!reminder) return [];

      const occurrence = taskId.slice(reminder.id.length + 1);
      const dueAt = reminder.onceAt ?? new Date(`${occurrence}T00:00:00.000Z`);

      return [
        {
          id: taskId,
          source: 'reminder',
          sourceId: reminder.id,
          subject: reminder.subject,
          kind: reminder.kind,
          label: reminder.label,
          dueAt: (isNaN(dueAt.getTime()) ? entry.occurredAt : dueAt).toISOString(),
          assigneeId: reminder.assigneeId,
          defaults: reminder.defaults,
          done: true,
          completion: { entryId: entry.id, occurredAt: entry.occurredAt.toISOString(), authorId: entry.authorId },
        },
      ];
    });
  }

  /**
   * A plan step that has served its time and is waiting to be told it may move
   * on. It is a task like any other - ticking it off confirms the step and
   * writes the line - and it is the one task whose subject is worked out rather
   * than stored: the plan belongs to a device, and what a device's work is about
   * is the grow standing in its tent, or the tent itself where nothing is.
   */
  private async planSteps(ctx: AccessContext, where: { spaceIds: string[]; growIds: string[] }, now: Date): Promise<Task[]> {
    const places = await this.placesWithDevices(where);
    if (places.length === 0) return [];

    const plans = await this.plans.find({ deviceId: { $in: places.map(place => place.deviceId) }, 'state.status': 'running' }).lean<StoredPlan[]>();
    const waiting = plans.flatMap(plan => {
      const step = activeStep(plan);
      const served = elapsedMs(plan.state, now);
      const place = places.find(candidate => candidate.deviceId === plan.deviceId);
      if (!step?.waitForConfirmation || !place || served < durationMs(step.duration)) return [];

      return [
        {
          id: planTaskId(plan.deviceId, plan.state.activeStepIndex),
          source: 'plan_step' as const,
          sourceId: step.id,
          subject: place.subject,
          kind: 'chore' as const,
          label: step.confirmationMessage || step.name,
          // When it fell due, which is what it has been waiting since.
          dueAt: new Date(now.getTime() - (served - durationMs(step.duration))).toISOString(),
          assigneeId: null,
          defaults: null,
          done: false,
          completion: null,
        },
      ];
    });

    // A looping plan comes back to the same step, and with it to the same task
    // id, so what was ticked off on an earlier turn is checked rather than
    // assumed away by the plan having moved on.
    const done = await this.entries.find({ taskId: { $in: waiting.map(task => task.id) } }, { taskId: 1 }).lean<Pick<EntryDocument, 'taskId'>[]>();
    const ticked = new Set(done.map(entry => entry.taskId));

    return waiting.filter(task => !ticked.has(task.id));
  }

  /** The devices standing where this caller keeps, each with the grow or space its tasks belong to. */
  private async placesWithDevices(where: { spaceIds: string[]; growIds: string[] }): Promise<Place[]> {
    const grows = await this.grows
      .find({ $or: [{ id: { $in: where.growIds } }, { placements: { $elemMatch: { spaceId: { $in: where.spaceIds }, endedAt: null } } }] })
      .lean<GrowDocument[]>();
    const spaceIds = [...new Set([...where.spaceIds, ...grows.flatMap(grow => grow.placements.filter(open).map(placement => placement.spaceId!))])];

    const devices = await this.devices.find({ spaceId: { $in: spaceIds } }, { id: 1, spaceId: 1 }).lean<Pick<StoredDevice, 'id' | 'spaceId'>[]>();

    return devices.flatMap(device => {
      if (!device.spaceId) return [];

      const grow = grows.find(candidate => candidate.placements.some(placement => open(placement) && placement.spaceId === device.spaceId));
      const subject: GrowOrSpaceRef = grow ? { type: 'grow', id: grow.id } : { type: 'space', id: device.spaceId };

      return [{ deviceId: device.id, subject }];
    });
  }
}

const open = (placement: { spaceId: string | null; endedAt: Date | null }): boolean => placement.endedAt === null && placement.spaceId !== null;

/** The rows after the cursor, for a list that has no query to put it in. */
const after = (tasks: Task[], cursor: string | undefined): Task[] => {
  if (!cursor) return tasks;

  const { at, id } = decodeCursor(cursor);
  const beyond = at.toISOString();

  return tasks.filter(task => task.dueAt > beyond || (task.dueAt === beyond && task.id > id));
};
