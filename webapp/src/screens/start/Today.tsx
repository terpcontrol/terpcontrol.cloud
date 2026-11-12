import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DueTask, Task } from '@fg2/shared-types/v1';
import { useTasks } from '@/api/tasks';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { enough, useMayInEach, useMayLogIn } from '@/ui/session-access';
import { useZone } from '@/ui/zone';
import { daysUntil, dueLabel, entryKindOf } from '@/screens/tasks/tasks';
import styles from './Start.module.css';

/** A task that is due, with where it stands: the place, and the grow a line about it is written against. */
export interface Due {
  task: DueTask;
  spaceId: string | null;
  place: string;
  grow: { growId: string; name: string } | null;
}

/**
 * "Heute": what is due today or overdue, each with the one tap that settles
 * it. A watering or a feeding is something to enter - how much, what - so it
 * opens the entry sheet on that kind, and the line written there closes the
 * task; a chore has nothing to enter and is ticked off. A step of the grow
 * plan waiting to be confirmed stands here too, for whoever may steer the
 * place, and asks first: it moves the plan on.
 *
 * `across` is Start with several places, where a row says where it is due
 * rather than since when. Nothing is drawn while nothing is due.
 */
export function Today({
  due,
  places,
  across = false,
  now,
}: {
  due: Due[];
  places: { spaceId: string; name: string }[];
  across?: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const { openSheet, complete } = useLog();
  const session = useMayLogIn();
  const mayIn = useMayInEach();
  const steered = places.filter(place => enough(mayIn(place.spaceId), 'manage'));
  const waiting = useTasks(false, steered.length > 0).data?.items ?? [];
  const steps = waiting.filter(
    task => task.source === 'plan_step' && daysUntil(task.dueAt, now, zone) <= 0 && steered.some(place => place.spaceId === task.subject.id),
  );
  const rows = due.filter(one => daysUntil(one.task.dueAt, now, zone) <= 0).sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt));
  if (rows.length === 0 && steps.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="start-today">
      <h2 className={styles.cardTitle} id="start-today">
        {t('start.today.title')}
      </h2>
      <ul className={styles.rows}>
        {rows.map(({ task, spaceId, place, grow }) => {
          const mayLog = session && (spaceId === null || enough(mayIn(spaceId), 'log'));
          const subject = task.subject.type === 'grow' ? (grow?.name ?? place) : place;
          const enters = grow !== null && (task.kind === 'water' || task.kind === 'feed');
          return (
            <li key={task.id} className={styles.due}>
              <span className={styles.dueText}>
                {task.label}
                <span className={styles.dueNote}>
                  {across ? [grow?.name, place].filter(Boolean).join(' · ') : dueLabel(t, task.dueAt, now, zone, { since: true })}
                </span>
              </span>
              {mayLog ? (
                <button
                  type="button"
                  className={styles.dueAction}
                  aria-label={`${t(enters ? 'start.today.enter' : 'home.strip.done')}: ${task.label}`}
                  onClick={() =>
                    enters
                      ? openSheet({ growId: grow.growId, spaceId, kind: entryKindOf(task.kind) as 'water' | 'feed' })
                      : complete(task.id, `${t(`home.entryKind.${entryKindOf(task.kind)}`)} · ${subject}`)
                  }
                >
                  {t(enters ? 'start.today.enter' : 'home.strip.done')}
                </button>
              ) : null}
            </li>
          );
        })}
        {steps.map(task => (
          <Step key={task.id} task={task} place={steered.find(place => place.spaceId === task.subject.id)!.name} across={across} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** A plan step waiting for its word. Confirming sends the next step's targets to the device and cannot be taken back, so it asks first. */
function Step({ task, place, across, now }: { task: Task; place: string; across: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { complete } = useLog();
  const [asking, setAsking] = useState(false);
  const title = t('tasks.planStepTitle', { label: task.label });

  return (
    <li className={styles.due}>
      <span className={styles.dueText}>
        {title}
        <span className={styles.dueNote}>{across ? place : dueLabel(t, task.dueAt, now, zone, { since: true })}</span>
      </span>
      {asking ? null : (
        <button type="button" className={styles.dueAction} aria-label={title} onClick={() => setAsking(true)}>
          {t('start.today.confirm')}
        </button>
      )}
      {asking ? (
        <div className={styles.dueAsk}>
          <Asking
            note={t('tasks.confirm.askUnnamed')}
            yes={t('tasks.confirm.yes')}
            busy={false}
            onYes={() => {
              setAsking(false);
              complete(task.id, `${t('tasks.stepConfirmed')} · ${place}`, { undoable: false });
            }}
            onCancel={() => setAsking(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
