import type { DateTime } from 'luxon';
import type { GrowListItem, GrowOrSpaceRef, Reminder, Space, Task } from '@fg2/shared-types/v1';
import { nowThere, WEEKDAY_DAY, zoned } from '@/ui/zone';

/**
 * The arithmetic of the Tasks tab, kept apart from the drawing so it can be
 * checked on its own: which group a task falls into, whose it is, and what its
 * meta line says.
 *
 * Days are counted in the account's own zone, which is where the grower's day
 * begins and where the server reads their quiet hours: a reader two zones from
 * their account otherwise files the evening's work under tomorrow. A task due
 * at any hour of today is today's, however early; one that was due yesterday is
 * today's as well, because the list is what is waiting rather than a calendar,
 * and the most overdue task is the one at the top.
 */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type Scope = 'mine' | 'all';

/** The three groups of what is waiting. What was ticked off is a fourth list with its own read. */
export type Group = 'today' | 'tomorrow' | 'week';

export const GROUPS: Group[] = ['today', 'tomorrow', 'week'];

/**
 * Whole calendar days from today to the day a task falls due; negative is
 * overdue. Both ends move into the account's zone together - a due date read
 * there against a today read here counts a day that is neither.
 */
export const daysUntil = (dueAt: string, now: DateTime, zone: string | null): number =>
  Math.floor(zoned(dueAt, zone).startOf('day').diff(nowThere(now, zone).startOf('day'), 'days').days);

export const groupOf = (task: Task, now: DateTime, zone: string | null): Group => {
  const days = daysUntil(task.dueAt, now, zone);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'week';
};

/** Mine is what is for me and what is for everyone who may log; a task with somebody else's name on it is not. */
export const isMine = (task: Task, userId: string | null): boolean => task.assigneeId === null || task.assigneeId === userId;

/** Ticked off, the newest tick first: that is the order a day's work was done in, read backwards. */
export const newestFirst = (tasks: Task[]): Task[] =>
  [...tasks].sort((one, other) => (other.completion?.occurredAt ?? '').localeCompare(one.completion?.occurredAt ?? ''));

/** The rhythm a task came from, where the reminders have arrived; null for a plan step and for a rhythm not (yet) known. */
export const reminderOf = (task: Task, reminders: Reminder[] | undefined): Reminder | null =>
  task.source === 'reminder' && task.sourceId ? (reminders?.find(reminder => reminder.id === task.sourceId) ?? null) : null;

/** What a task is about, by name. Null while the grows and spaces have not answered yet, so a card never shows an id. */
export const subjectName = (subject: GrowOrSpaceRef, grows: GrowListItem[] | undefined, spaces: Space[] | undefined): string | null =>
  subject.type === 'grow'
    ? (grows?.find(grow => grow.id === subject.id)?.name ?? null)
    : (spaces?.find(space => space.id === subject.id)?.name ?? null);

/**
 * The one default simple enough to say on a card: how big the can is. A feed's
 * doses and a measurement's readings are the sheet's to show, not a line's.
 */
export const litresOf = (defaults: unknown): number | null => {
  if (!defaults || typeof defaults !== 'object') return null;
  const values = defaults as { kind?: unknown; litres?: unknown };
  return (values.kind === 'water' || values.kind === 'feed') && typeof values.litres === 'number' ? values.litres : null;
};

const SCOPE_KEY = 'terp.tasks.scope';

/** Mine, unless All was chosen last time. Storage that is blocked or empty is simply the default. */
export const storedScope = (): Scope => {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
};

export const storeScope = (scope: Scope): void => {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // The choice then lasts as long as the tab, which is better than refusing it.
  }
};

/**
 * "Tue 16 Sep": the words in the language the app is being read in, so a German
 * screen does not carry an English weekday, and the order the app's one date
 * shape gives them.
 *
 * The language chooses the words and nothing else. Asked for the shape as well,
 * through `toLocaleString`, it answered "Wed, Sep 16" in English - the American
 * order - and "Mi., 16. Sept." in German, while the archive and the account's
 * sessions two taps away wrote "24 Aug 2026" in both; a reader had one screen
 * putting the month first and another putting the day first with nothing to say
 * why.
 */
export const dateLabel = (at: DateTime, language: string): string => at.setLocale(language).toFormat(WEEKDAY_DAY);

/** "today", "yesterday", or the day itself for a tick older than that. */
export const dayLabel = (t: Translate, at: string, now: DateTime, language: string, zone: string | null): string => {
  const days = daysUntil(at, now, zone);
  if (days === 0) return t('tasks.ticked.today');
  if (days === -1) return t('tasks.ticked.yesterday');
  return dateLabel(zoned(at, zone), language);
};
