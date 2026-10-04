import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { ReminderCreate, ReminderUpdate } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound, unprocessable } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { VisibleSubjectsService } from './visible-subjects.service';

/**
 * The rhythms somebody keeps: water every three days, feed on Sunday, change
 * the filter once.
 *
 * A reminder is the only thing a task is stored as. The task itself is derived
 * on every read and never written down, so everything that decides when work
 * falls due - the rhythm, what it is called, what its entry is prefilled with -
 * lives here, and the collection carries one row per rhythm rather than one per
 * occurrence.
 *
 * Writing one is `manage` rather than `log`: a reminder is not a line somebody
 * adds to the diary but a standing arrangement that puts work on everybody's
 * card, which is the same kind of decision as a tent's configuration.
 */

/** What a list of reminders narrows by: the grow or the space they are about. */
export interface ReminderFilter {
  growId?: string;
  spaceId?: string;
}

@Injectable()
export class RemindersService {
  constructor(
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly access: AccessService,
    private readonly visible: VisibleSubjectsService,
  ) {}

  public async byId(id: string): Promise<ReminderDocument> {
    const reminder = await this.reminders.findOne({ id }).lean<ReminderDocument>();
    if (!reminder) throw notFound('reminder_not_found', 'There is no reminder with that id.');

    return reminder;
  }

  /**
   * Newest first, held to what the caller can see. A named grow or space has
   * been decided on already and is the whole filter; an unnamed one is every
   * place this account keeps, which is worked out once as two lists of ids.
   */
  public async list(ctx: AccessContext, query: PageQuery, filter: ReminderFilter, limit: number): Promise<CursorPage<ReminderDocument>> {
    if (filter.growId) await this.access.require(ctx, subjectRef('grow', filter.growId), 'view');
    if (filter.spaceId) await this.access.require(ctx, subjectRef('space', filter.spaceId), 'view');

    const about = await this.about(ctx, filter);
    if (!about) return { items: [], nextCursor: null };

    // Combined rather than merged into one object: what the caller may see is an
    // `$or` of its own and so is the cursor, and one would silently replace the
    // other - which hands out other people's rhythms from the second page on
    // while the first page looks right.
    const conditions: FilterQuery<ReminderDocument>[] = [about, afterCursor('createdAt', query.cursor)];
    const rows = await this.reminders.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<ReminderDocument[]>();

    return pageOf(rows, limit, reminder => ({ at: reminder.createdAt, id: reminder.id }));
  }

  public async create(ctx: AccessContext, body: ReminderCreate): Promise<ReminderDocument> {
    await this.access.require(ctx, subjectRef(body.subject.type, body.subject.id), 'manage');
    requireOneRhythm(body.everyDays, body.onceAt);
    await this.requireRunning(body.subject);
    await this.requireAssignee(body.subject, body.assigneeId ?? null);

    const reminder: ReminderDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      subject: { type: body.subject.type, id: body.subject.id },
      kind: body.kind,
      label: body.label,
      everyDays: body.everyDays,
      onceAt: body.onceAt === null ? null : new Date(body.onceAt),
      assigneeId: body.assigneeId ?? null,
      defaults: body.defaults ?? null,
      createdBy: ctx.userId!,
    };

    await this.reminders.create(reminder);
    return reminder;
  }

  /**
   * What a reminder is about is not changed here. A rhythm moved from one tent
   * to another is a different arrangement, decided by whoever manages the place
   * it would land in - so it is written there and taken back here.
   */
  public async update(ctx: AccessContext, id: string, body: ReminderUpdate): Promise<ReminderDocument> {
    const reminder = await this.byId(id);
    await this.access.require(ctx, subjectRef(reminder.subject.type, reminder.subject.id), 'manage');

    if (body.subject && (body.subject.type !== reminder.subject.type || body.subject.id !== reminder.subject.id)) {
      throw unprocessable('reminder_moved', 'A reminder stays with the grow or the space it was made for.', [
        { field: 'subject', code: 'immutable', detail: 'Make it again where it belongs and delete this one.' },
      ]);
    }

    const everyDays = body.everyDays === undefined ? reminder.everyDays : body.everyDays;
    const onceAt = body.onceAt === undefined ? (reminder.onceAt?.toISOString() ?? null) : body.onceAt;
    requireOneRhythm(everyDays, onceAt);
    if (body.assigneeId !== undefined) await this.requireAssignee(reminder.subject, body.assigneeId);

    const changes: Partial<ReminderDocument> = {};
    if (body.kind !== undefined) changes.kind = body.kind;
    if (body.label !== undefined) changes.label = body.label;
    if (body.everyDays !== undefined) changes.everyDays = body.everyDays;
    if (body.onceAt !== undefined) changes.onceAt = body.onceAt === null ? null : new Date(body.onceAt);
    if (body.assigneeId !== undefined) changes.assigneeId = body.assigneeId;
    if (body.defaults !== undefined) changes.defaults = body.defaults;

    if (Object.keys(changes).length === 0) return reminder;

    const changed = await this.reminders.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<ReminderDocument>();
    if (!changed) throw notFound('reminder_not_found', 'There is no reminder with that id.');

    return changed;
  }

  /**
   * The rhythm stops. The lines it already produced stay: a diary says what was
   * done, and what was done does not stop having happened because nobody is
   * asked to do it again.
   */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    const reminder = await this.byId(id);
    await this.access.require(ctx, subjectRef(reminder.subject.type, reminder.subject.id), 'manage');

    await this.reminders.deleteOne({ id });
  }

  /** The filter a list is held to, or null where the caller keeps nowhere at all. */
  private async about(ctx: AccessContext, filter: ReminderFilter): Promise<FilterQuery<ReminderDocument> | null> {
    if (filter.growId) return { 'subject.type': 'grow', 'subject.id': filter.growId };
    if (filter.spaceId) return { 'subject.type': 'space', 'subject.id': filter.spaceId };

    const { spaceIds, growIds } = await this.visible.subjectsOf(ctx);
    if (spaceIds.length === 0 && growIds.length === 0) return null;

    return {
      $or: [
        { 'subject.type': 'space', 'subject.id': { $in: spaceIds } },
        { 'subject.type': 'grow', 'subject.id': { $in: growIds } },
      ],
    };
  }

  /**
   * A rhythm kept for a grow that has ended would put work on a card for plants
   * that are no longer there - a daily watering for a grow harvested in August.
   * Nothing takes it off again, either: the tasks of an ended grow are not on
   * the board, so the reminder would sit there producing them unseen until
   * somebody opened that grow's own list.
   */
  private async requireRunning(subject: { type: 'grow' | 'space'; id: string }): Promise<void> {
    if (subject.type !== 'grow') return;

    const ended = await this.grows.exists({ id: subject.id, endedAt: { $ne: null } });
    if (ended)
      throw conflict(
        'grow_ended',
        'This grow has ended, so there is nothing left to remind anybody of. Keep the rhythm on the grow that follows it.',
      );
  }

  /**
   * Whom the task is for. Somebody who may not log here would be asked for work
   * they are not allowed to write down, so the assignee is decided by the same
   * function that decides every other request - asked on their behalf rather
   * than on the caller's.
   */
  private async requireAssignee(subject: { type: 'grow' | 'space'; id: string }, assigneeId: string | null): Promise<void> {
    if (assigneeId === null) return;

    const asThem = { userId: assigneeId, isAdmin: false, isDemo: false, shareToken: null };
    if (await this.access.access(asThem, subjectRef(subject.type, subject.id), 'log')) return;

    throw unprocessable('assignee_cannot_log', 'A reminder can only be given to somebody who may write in this diary.', [
      { field: 'assigneeId', code: 'not_a_keeper', detail: assigneeId },
    ]);
  }
}

/**
 * Exactly one of the two, which is what the contract says and what the
 * derivation needs: a rhythm and a date would each put a task on the card and
 * the same reminder would come due twice.
 */
const requireOneRhythm = (everyDays: number | null, onceAt: string | null): void => {
  if ((everyDays === null) === (onceAt === null)) {
    throw unprocessable('reminder_has_no_rhythm', 'A reminder repeats every so many days or falls due once, and says which.', [
      { field: 'everyDays', code: 'exactly_one', detail: 'Set `everyDays` or `onceAt`, and leave the other null.' },
    ]);
  }

  if (everyDays !== null && everyDays < 1) {
    throw unprocessable('rhythm_too_short', 'A rhythm is a whole number of days.', [
      { field: 'everyDays', code: 'too_small', detail: String(everyDays) },
    ]);
  }
};
