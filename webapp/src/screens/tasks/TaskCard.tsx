import { UserRound } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Reminder, SessionUser, Task } from '@fg2/shared-types/v1';
import { initials } from '@/app/shell/tabs';
import ui from '@/ui/ui.module.css';
import { dayLabel, daysUntil, litresOf, type Translate } from './tasks';
import styles from './Tasks.module.css';

interface TaskCardProps {
  task: Task;
  /** What the task is about, by name; null until the grows and spaces have answered. */
  name: string | null;
  /** The rhythm behind a reminder task, where it is known; null for a plan step. */
  reminder: Reminder | null;
  me: SessionUser | null;
  now: DateTime;
  /** The tick, or null for a session that may only look - which is then offered no circle to tap. */
  onDone: (() => void) | null;
  /** Opening the rhythm to change it, where this session manages the place and the task is a reminder's. */
  onEdit: (() => void) | null;
}

/**
 * One thing waiting to be done. The circle on the left is the whole
 * interaction: a tap writes the diary line the task implies, and the toast is
 * where it can still be taken back. The line under the title says where the
 * task came from and when it is due, and the mark on the right says whose it
 * is.
 */
export function TaskCard({ task, name, reminder, me, now, onDone, onEdit }: TaskCardProps) {
  const { t } = useTranslation();
  const title = task.source === 'plan_step' || !name ? task.label : `${task.label} · ${name}`;

  return (
    <li className={`${ui.card} ${styles.card}`}>
      {onDone ? (
        <button type="button" className={styles.circle} aria-label={t('tasks.doneAria', { label: title })} onClick={onDone} />
      ) : (
        <span className={styles.circle} aria-hidden />
      )}
      <span className={styles.text}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={`mono ${styles.meta}`}>{metaLine(t, task, name, reminder, now)}</span>
      </span>
      {onEdit ? (
        <button type="button" className={`${ui.chip} ${styles.edit}`} onClick={onEdit}>
          {t('tasks.edit')}
        </button>
      ) : null}
      <Assignee task={task} me={me} />
    </li>
  );
}

/**
 * What a task was ticked off as. It stays on the list for two days, dimmed and
 * dated, so the morning's work is struck through rather than simply gone; it
 * is not a control any more and does nothing when tapped.
 */
export function DoneCard({ task, name, me, now }: { task: Task; name: string | null; me: SessionUser | null; now: DateTime }) {
  const { t, i18n } = useTranslation();
  const completion = task.completion;
  const who = t(completion?.authorId && completion.authorId === me?.id ? 'tasks.ticked.you' : 'tasks.ticked.somebody');

  return (
    <li className={`${ui.card} ${styles.card}`} data-done="true">
      <span className={styles.circle} data-filled="true" aria-hidden />
      <span className={styles.text}>
        <span className={styles.cardTitle}>{name ? `${task.label} · ${name}` : task.label}</span>
        <span className={`mono ${styles.meta}`}>
          {who}
          {completion
            ? ` · ${dayLabel(t, completion.occurredAt, now, i18n.language)} ${DateTime.fromISO(completion.occurredAt).toFormat('HH:mm')}`
            : ''}
        </span>
      </span>
      <Assignee task={task} me={me} />
    </li>
  );
}

/**
 * Whose the task is: my initials when it is mine, a plain mark when it is
 * somebody else's, nothing when it is everyone's. The handles of the other
 * people who work in a place do not travel with a task yet, so somebody else
 * can only be marked as that rather than named.
 */
function Assignee({ task, me }: { task: Task; me: SessionUser | null }) {
  const { t } = useTranslation();
  if (task.assigneeId === null) return null;

  if (me && task.assigneeId === me.id) {
    return (
      <span className={`mono ${styles.avatar}`} role="img" aria-label={t('tasks.assignedToYou')}>
        {initials(me.handle)}
      </span>
    );
  }

  return (
    <span className={styles.assigned} role="img" aria-label={t('tasks.assignedToSomeone')}>
      <UserRound size={14} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** "every 3 d · 2 L · today", or "grow plan · Tent 1 · in 2 d": where the task came from, then when it is due. */
const metaLine = (t: Translate, task: Task, name: string | null, reminder: Reminder | null, now: DateTime): string => {
  const parts: string[] = [];

  if (task.source === 'plan_step') {
    parts.push(t('tasks.planStep'));
    if (name) parts.push(name);
  } else {
    if (reminder) parts.push(reminder.everyDays ? t('tasks.every', { count: reminder.everyDays }) : t('tasks.once'));
    if (task.kind === 'chore' || task.kind === 'custom') parts.push(t(`tasks.kind.${task.kind}`));
    const litres = litresOf(task.defaults);
    if (litres !== null) parts.push(t('log.litres', { litres }));
  }

  parts.push(dueLabel(t, task, now));
  return parts.join(' · ');
};

const dueLabel = (t: Translate, task: Task, now: DateTime): string => {
  const days = daysUntil(task.dueAt, now);
  if (days < 0) return t('tasks.due.overdue', { count: -days });
  if (days === 0) return t('tasks.due.today');
  if (days === 1) return t('tasks.due.tomorrow');
  return t('tasks.due.inDays', { count: days });
};
