import { UserRound } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Reminder, SessionUser, Task } from '@fg2/shared-types/v1';
import { useDevicePlan } from '@/api/plans';
import type { Translate } from '@/i18n/i18n';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { initials } from '@/ui/handle';
import { nextStepIndex } from '@/screens/control/plan-clock';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import { dayLabel, dueLabel, litresOf, onceLabel } from './tasks';
import { looseFigure } from '@/ui/figures';
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
  /**
   * Why there is no circle to tap, where the reason is worth saying: a card
   * with a dead circle and nothing beside it reads as a card that is broken.
   */
  why?: string | null;
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
export function TaskCard({ task, name, reminder, deviceId, me, now, onDone, onEdit, why = null }: TaskCardProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const [asking, setAsking] = useState(false);
  const title = titleOf(t, task);
  const asks = task.source === 'plan_step';

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <div className={ui.row3}>
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
        <span className={ui.textColumn}>
          <span className={styles.cardTitle}>{title}</span>
          <Facts className={styles.meta} facts={metaLine(t, task, name, reminder, now, zone)} />
        </span>
        {onEdit ? (
          <button type="button" className={`${ui.chip} ${styles.edit}`} onClick={onEdit}>
            {t('tasks.edit')}
          </button>
        ) : null}
        <Assignee task={task} me={me} />
      </div>

      {!onDone && why ? <p className={`${ui.note} ${styles.why}`}>{why}</p> : null}

      {asking && onDone ? (
        <Asking
          note={deviceId ? <NextStep deviceId={deviceId} /> : t('tasks.confirm.askUnnamed')}
          yes={t('tasks.confirm.yes')}
          busy={false}
          onYes={() => {
            setAsking(false);
            onDone();
          }}
          onCancel={() => setAsking(false)}
        />
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

  if (!plan.data) return t('tasks.confirm.askUnnamed');

  const next = nextStepIndex(plan.data);
  const name = next === null ? null : (plan.data.steps[next]?.name ?? null);

  return next === null ? t('tasks.confirm.askEnds') : name ? t('tasks.confirm.ask', { name }) : t('tasks.confirm.askUnnamed');
}

/**
 * What a task was ticked off as. It stays on the list for two days, dimmed and
 * dated, so the morning's work is struck through rather than simply gone; it
 * is not a control any more and does nothing when tapped.
 */
export function DoneCard({ task, name, by, me, now }: { task: Task; name: string | null; by: string | null; me: SessionUser | null; now: DateTime }) {
  const { t, i18n } = useTranslation();
  // The hour a task was ticked off at, in the account's zone: the alerts inbox
  // beside this list has always drawn its instants there, and the same tick
  // read 10:39 on one screen and 12:39 here.
  const zone = useZone();
  const completion = task.completion;
  // `by` is the handle of somebody else who ticked it, where the people of its place have answered.
  const who = completion?.authorId && completion.authorId === me?.id ? t('tasks.ticked.you') : by ? `@${by}` : t('tasks.ticked.somebody');
  const at = completion ? `${dayLabel(t, completion.occurredAt, now, i18n.language, zone)} ${clock(completion.occurredAt, zone)}` : null;

  return (
    <li className={`${ui.card} ${styles.card}`} data-done="true">
      <div className={ui.row3}>
        <span className={styles.circle} data-filled="true" aria-hidden />
        <span className={ui.textColumn}>
          <span className={styles.cardTitle}>{titleOf(t, task)}</span>
          <Facts className={styles.meta} facts={[who, name, at]} />
        </span>
        <Assignee task={task} me={me} />
      </div>
    </li>
  );
}

/**
 * One rhythm as an arrangement rather than as something to do: what it is
 * about, how often it comes round, and the way into the sheet that changes or
 * stops it.
 *
 * It says nothing about when the next turn falls. That is counted from the
 * last time the rhythm was ticked off, which the server works out on every
 * read of the task list and this row has not got - and a date worked out here
 * from the day the rhythm was written would disagree with the card above it
 * the first time anybody did the chore early.
 */
export function RhythmCard({
  reminder,
  name,
  language,
  onEdit,
}: {
  reminder: Reminder;
  name: string | null;
  language: string;
  onEdit: (() => void) | null;
}) {
  const { t } = useTranslation();
  // The day the rhythm falls on, where the account is: the card above this list
  // counts the days to the same reminder in that zone, and the two rows named
  // different days for one reminder to every reader behind their account.
  const zone = useZone();
  const parts = [
    reminder.everyDays ? t('tasks.every', { count: reminder.everyDays }) : t('tasks.onceOn', { date: onceLabel(reminder.onceAt!, language, zone) }),
    name,
    kindAside(t, reminder.kind, reminder.label),
  ];

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <div className={ui.row3}>
        <span className={ui.textColumn}>
          <span className={styles.cardTitle}>{reminder.label}</span>
          <Facts className={styles.meta} facts={parts} />
        </span>
        {onEdit ? (
          <button type="button" className={`${ui.chip} ${styles.edit}`} onClick={onEdit}>
            {t('tasks.edit')}
          </button>
        ) : null}
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
      <span className={styles.avatar} role="img" aria-label={t('tasks.assignedToYou')}>
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

/**
 * The kind beside a reminder's or a task's name, by the name the sheet gives it ("Gießen"): only where there is one
 * to name - "custom" is what a reminder is called when its label says everything - and not where the label says it
 * already, which "Gießen · … · gießen" did twice.
 */
const kindAside = (t: Translate, kind: Task['kind'], label: string): string | null => {
  if (kind === 'custom') return null;
  const word = t(`tasks.kind.${kind}`);
  return label.toLowerCase().includes(word.toLowerCase()) ? null : word;
};

/** "every 3 d · Spring run · Water · 2 L · today", or "grow plan · Tent 1 · in 2 d": where the task came from, which place it is about, then when it is due. */
const metaLine = (t: Translate, task: Task, name: string | null, reminder: Reminder | null, now: DateTime, zone: string | null): string[] => {
  const parts: string[] = [];

  if (task.source === 'plan_step') {
    parts.push(t('tasks.planStep'));
    if (name) parts.push(name);
  } else {
    if (reminder) parts.push(reminder.everyDays ? t('tasks.every', { count: reminder.everyDays }) : t('tasks.once'));
    if (name) parts.push(name);
    const kind = kindAside(t, task.kind, task.label);
    if (kind) parts.push(kind);
    const litres = litresOf(task.defaults);
    if (litres !== null) parts.push(t('log.litres', { litres: looseFigure(litres) }));
  }

  // When it is due in Start's words, so one task reads the same on every list.
  parts.push(dueLabel(t, task.dueAt, now, zone, { since: true }));
  return parts;
};
