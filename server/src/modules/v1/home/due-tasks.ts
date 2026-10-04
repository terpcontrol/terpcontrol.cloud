import type { DueTask } from '@fg2/shared-types/v1';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';

/**
 * The tasks a reminder puts on a card, worked out at read time.
 *
 * Tasks are never stored. A reminder that happens once is one task, and its id
 * is the reminder's; a rhythm is a task per occurrence, whose id names the
 * instant it falls due, so that "done" - an entry carrying that id - closes that
 * one occurrence and the rhythm carries on from it. What the scheme grid and
 * the plan contribute is derived where those are read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead a card looks. Anything overdue is due; tomorrow is close enough to prepare for. */
export const DUE_HORIZON_MS = 2 * DAY_MS;

/** How far ahead the task list looks: its board has a column for the rest of the week. */
export const WEEK_HORIZON_MS = 7 * DAY_MS;

/** The prefix of every occurrence of a rhythm, which is how its completions are found. */
export const occurrencePrefix = (reminderId: string): string => `${reminderId}:`;

/**
 * An occurrence is named by the millisecond it falls due, not by its day.
 *
 * Named by its UTC day, the next occurrence after a tick taken a day early -
 * anything under "Tomorrow" on a daily rhythm, or for an account east of UTC a
 * tick between local and UTC midnight - fell on the very day it had just
 * closed, came back under the same id, and every tick on it was refused as
 * done already: the rhythm was jammed for good. The next occurrence is counted
 * from the tick, so its instant is always a new one.
 *
 * Ids written before this carry a day (`…:2026-09-25`); they still close their
 * own occurrence and still count as the newest tick, which is all that is ever
 * asked of them.
 */
const occurrenceId = (reminder: ReminderDocument, dueAt: Date): string => `${occurrencePrefix(reminder.id)}${dueAt.getTime()}`;

/** When the occurrence an id names fell due: its instant, or the start of its day for an id written by day. */
export const occurrenceDueAt = (occurrence: string): Date | null => {
  const at = /^\d+$/.test(occurrence) ? new Date(Number(occurrence)) : new Date(`${occurrence}T00:00:00.000Z`);

  return isNaN(at.getTime()) ? null : at;
};

const taskOf = (reminder: ReminderDocument, id: string, dueAt: Date): DueTask => ({
  id,
  kind: reminder.kind,
  label: reminder.label,
  dueAt: dueAt.toISOString(),
  subject: reminder.subject,
  assigneeId: reminder.assigneeId,
});

/**
 * Which tasks are due within the horizon. `completions` are the entries that
 * carry a task id of these reminders; a rhythm counts from its newest
 * completion, or from the day it was set up. A rhythm yields its next
 * occurrence and nothing after it, however far the horizon reaches: the one
 * after that is counted from the completion that has not happened yet.
 */
export const dueTasksOf = (
  reminders: ReminderDocument[],
  completions: EntryDocument[],
  now: Date = new Date(),
  horizonMs: number = DUE_HORIZON_MS,
): DueTask[] => {
  const horizon = now.getTime() + horizonMs;
  const done = new Set(completions.map(entry => entry.taskId));

  return reminders.flatMap(reminder => {
    if (reminder.onceAt) {
      return !done.has(reminder.id) && reminder.onceAt.getTime() <= horizon ? [taskOf(reminder, reminder.id, reminder.onceAt)] : [];
    }
    if (!reminder.everyDays) return [];

    const last = completions
      .filter(entry => entry.taskId?.startsWith(occurrencePrefix(reminder.id)))
      .reduce<Date | null>((newest, entry) => (newest && newest > entry.occurredAt ? newest : entry.occurredAt), null);
    let dueAt = new Date((last ?? reminder.createdAt).getTime() + reminder.everyDays * DAY_MS);
    // An occurrence that is done is never offered again. Counted from the
    // newest tick that cannot happen, short of a tick backdated to the very
    // millisecond of an earlier one; were it to, the rhythm steps on rather
    // than offering a card every tap on which is refused.
    while (done.has(occurrenceId(reminder, dueAt))) dueAt = new Date(dueAt.getTime() + reminder.everyDays * DAY_MS);

    return dueAt.getTime() <= horizon ? [taskOf(reminder, occurrenceId(reminder, dueAt), dueAt)] : [];
  });
};
