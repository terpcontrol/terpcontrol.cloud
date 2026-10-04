import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { logger } from '@utils/logger';
import { dueTasksOf, occurrencePrefix } from '../home/due-tasks';
import { taskAnnouncement } from './notification-messages';
import { NotificationService } from './notification.service';
import { RecipientsService } from './recipients.service';

/**
 * The loop that says a task is due.
 *
 * Nothing else would: an alarm is announced by the thing that raised it, and a
 * task is not raised by anything - it simply becomes true at some point in the
 * night. So the fleet's rhythms are walked, what is due is worked out the same
 * way a card works it out, and whoever keeps the place is told once.
 *
 * Once is the whole difficulty. A task that is due stays due until somebody
 * does it, and this runs every hour, so the notification log is what makes the
 * difference between a reminder and a nag: a task's id names the occurrence,
 * the log remembers the id, and the second hour says nothing.
 */

const TICK_MS = 60 * 60 * 1000;

/** Far enough into the run that the first pass does not land in the middle of a boot. */
const FIRST_PASS_MS = 60 * 1000;

@Injectable()
export class TaskAnnouncerService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientsService,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The first pass of the task announcer', () => this.run(), FIRST_PASS_MS);
    this.work.repeat('The task announcer', () => this.run(), TICK_MS);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the task announcer');
    this.work.stop();
  }

  /** One pass over the rhythms. Public so it can be run once, in a test or by hand. */
  public async run(now: Date = new Date()): Promise<void> {
    const reminders = await this.reminders.find({}).lean<ReminderDocument[]>();
    if (reminders.length === 0) return;

    const kept = await this.stillKept(reminders);
    const wanted = reminders.filter(reminder => kept.has(reminder.subject.id));
    if (wanted.length === 0) return;

    const completions = await this.completionsOf(wanted);
    // Due now, not due soon: a card may show tomorrow's work so somebody can
    // prepare for it, but nobody's phone should go off about it the day before.
    const due = dueTasksOf(wanted, completions, now).filter(task => Date.parse(task.dueAt) <= now.getTime());

    for (const task of due) {
      const reminder = wanted.find(candidate => task.id === candidate.id || task.id.startsWith(occurrencePrefix(candidate.id)));
      if (!reminder) continue;

      for (const userId of await this.whoToTell(reminder)) await this.notifications.tellOnce(userId, taskAnnouncement(task));
    }
  }

  /**
   * Whom the work is for. A reminder given to somebody names that person and
   * nobody else, which is what an assignee is for; one given to nobody in
   * particular is everybody who keeps the place.
   */
  private whoToTell(reminder: ReminderDocument): Promise<string[]> {
    if (reminder.assigneeId) return Promise.resolve([reminder.assigneeId]);

    return reminder.subject.type === 'grow' ? this.recipients.forGrow(reminder.subject.id) : this.recipients.forSpace(reminder.subject.id);
  }

  /**
   * The grows and spaces somebody is still working in. A grow that has ended
   * and a space that has been archived take their rhythms with them: the rows
   * are still there to be read and deleted, and nothing about them is worth
   * anybody's evening.
   */
  private async stillKept(reminders: ReminderDocument[]): Promise<Set<string>> {
    const growIds = reminders.flatMap(reminder => (reminder.subject.type === 'grow' ? [reminder.subject.id] : []));
    const spaceIds = reminders.flatMap(reminder => (reminder.subject.type === 'space' ? [reminder.subject.id] : []));

    const [grows, spaces] = await Promise.all([
      this.grows.find({ id: { $in: growIds }, endedAt: null }, { id: 1 }).lean<Pick<GrowDocument, 'id'>[]>(),
      this.spaces.find({ id: { $in: spaceIds }, archivedAt: null }, { id: 1 }).lean<Pick<SpaceDocument, 'id'>[]>(),
    ]);

    return new Set([...grows.map(grow => grow.id), ...spaces.map(space => space.id)]);
  }

  /** The entries that ticked a task of these reminders off: a one-off by its id, a rhythm by any of its occurrences. */
  private completionsOf(reminders: ReminderDocument[]): Promise<EntryDocument[]> {
    return this.entries
      .find({ $or: reminders.map(reminder => ({ taskId: reminder.onceAt ? reminder.id : { $regex: `^${occurrencePrefix(reminder.id)}` } })) })
      .lean<EntryDocument[]>();
  }
}
