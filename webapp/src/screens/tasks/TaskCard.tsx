import { UserRound } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Reminder, SessionUser, Task } from '@fg2/shared-types/v1';
import { useDevicePlan } from '@/api/plans';
import { initials } from '@/app/shell/tabs';
import { nextStepIndex } from '@/screens/control/plan-clock';
import ui from '@/ui/ui.module.css';
import { dayLabel, daysUntil, litresOf, type Translate } from './tasks';
import styles from './Tasks.module.css';

interface TaskCardProps {
  task: Task;
  /** What the task is about, by name; null until the grows and spaces have answered. */
  name: string | null;
  /** The rhythm behind a reminder task, where it is known; null for a plan step. */
  reminder: Reminder | null;
  /** The controller whose plan a step belongs to, where the device list has answered; null for anything else. */
  deviceId: string | null;
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
 * task came from, which place it is about and when it is due, and the mark on
 * the right says whose it is.
 *
 * The title is the label and nothing else. The name of the tent or the grow
 * belongs on the line under it: on a phone the two together are wider than the
 * card, and it was the name that was cut off - the half that says which tent
 * is the half a person on the way to one needs.
 *
 * A plan step is the one task the circle asks about first. Ticking it moves the
 * plan on and sends the next step's targets to the controller, which is a change
 * to what the tent is holding rather than a diary line, and it cannot be taken
 * back from here.
 */
export function TaskCard({ task, name, reminder, deviceId, me, now, onDone, onEdit }: TaskCardProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const title = titleOf(t, task);
  const asks = task.source === 'plan_step';

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <div className={styles.row}>
        {onDone ? (
          <button
            type="button"
            className={styles.circle}
            aria-label={t('tasks.doneAria', { label: title })}
            aria-expanded={asks ? asking : undefined}
            onClick={() => (asks ? setAsking(!asking) : onDone())}
          />
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
      </div>

      {asking && onDone ? (
        <div className={styles.stepAsk}>
          {deviceId ? <NextStep deviceId={deviceId} /> : <p className={ui.note}>{t('tasks.confirm.askUnnamed')}</p>}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              onClick={() => {
                setAsking(false);
                onDone();
              }}
            >
              {t('tasks.confirm.yes')}
            </button>
            <button type="button" className={ui.button} onClick={() => setAsking(false)}>
              {t('tasks.confirm.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * What confirming the step will start, by name. The plan itself is read for it,
 * because "the next one" is not what somebody standing in the tent needs to
 * hear; a plan that has not answered yet, or a device that is running none, is
 * said without the name rather than holding the question open until it does.
 */
function NextStep({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const plan = useDevicePlan(deviceId);

  if (!plan.data) return <p className={ui.note}>{t('tasks.confirm.askUnnamed')}</p>;

  const next = nextStepIndex(plan.data);
  const name = next === null ? null : (plan.data.steps[next]?.name ?? null);

  return (
    <p className={ui.note}>{next === null ? t('tasks.confirm.askEnds') : name ? t('tasks.confirm.ask', { name }) : t('tasks.confirm.askUnnamed')}</p>
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
      <div className={styles.row}>
        <span className={styles.circle} data-filled="true" aria-hidden />
        <span className={styles.text}>
          <span className={styles.cardTitle}>{titleOf(t, task)}</span>
          <span className={`mono ${styles.meta}`}>
            {[
              who,
              name,
              completion
                ? `${dayLabel(t, completion.occurredAt, now, i18n.language)} ${DateTime.fromISO(completion.occurredAt).toFormat('HH:mm')}`
                : null,
            ]
              .filter(part => part !== null)
              .join(' · ')}
          </span>
        </span>
        <Assignee task={task} me={me} />
      </div>
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

/**
 * What the card is called. A plan step is not a chore that was thought of in
 * advance but a question the plan is waiting to have answered, and the tick
 * answers it: saying so in the title is what makes the circle beside it read
 * as the confirmation it is.
 */
const titleOf = (t: Translate, task: Task): string => (task.source === 'plan_step' ? t('tasks.planStepTitle', { label: task.label }) : task.label);

/** "every 3 d · Spring run · water · 2 L · today", or "grow plan · Tent 1 · in 2 d": where the task came from, which place it is about, then when it is due. */
const metaLine = (t: Translate, task: Task, name: string | null, reminder: Reminder | null, now: DateTime): string => {
  const parts: string[] = [];

  if (task.source === 'plan_step') {
    parts.push(t('tasks.planStep'));
    if (name) parts.push(name);
  } else {
    if (reminder) parts.push(reminder.everyDays ? t('tasks.every', { count: reminder.everyDays }) : t('tasks.once'));
    if (name) parts.push(name);
    // A category of its own only where there is one to name: "custom" is what a
    // reminder is called when its label already says everything about it.
    if (task.kind !== 'custom') parts.push(t(`tasks.kindMeta.${task.kind}`));
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
