import type { QueryClient } from '@tanstack/react-query';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@fg2/shared-types/v1';
import { planMoved } from '@/api/plans';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { enough, useMayInEach, useMayLogIn } from '@/ui/session-access';
import { useZone } from '@/ui/zone';
import { dueLabel, entryKindOf, tickedLabel } from '@/screens/tasks/tasks';
import { useDueList, type Due, type DueNow, type Place } from './due';
import styles from './Start.module.css';

/**
 * "Heute": what is due today or overdue, each with the one tap that settles
 * it. Nothing is drawn while nothing is due. `across` is Start with several
 * places, where a row says where it is due rather than since when.
 */
export function Today({ due, places, across = false, now }: { due: Due[]; places: Place[]; across?: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const list = useDueList(due, places, now);
  if (list.rows.length + list.steps.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="start-today">
      <h2 className={styles.cardTitle} id="start-today">
        {t('start.today.title')}
      </h2>
      <DueList {...list} across={across} now={now} />
    </section>
  );
}

/**
 * The rows of what is due - on Start under "Heute", behind the bell under
 * "Aufgaben". A watering or a feeding is something to enter - how much, what -
 * so it opens the entry sheet on that kind, and the line written there closes
 * the task; a chore has nothing to enter and is ticked off, and the toast
 * names it. A step of the grow plan waiting to be confirmed stands here too,
 * for whoever may steer the place, and asks first: it moves the plan on.
 */
export function DueList({ rows, steps, across, now }: DueNow & { across: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { openSheet, complete } = useLog();
  const session = useMayLogIn();
  const mayIn = useMayInEach();

  return (
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
                {across ? <Facts facts={[grow?.name, place]} /> : dueLabel(t, task.dueAt, now, zone, { since: true })}
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
                    : complete(task.id, tickedLabel(t, task, across ? subject : null))
                }
              >
                {t(enters ? 'start.today.enter' : 'home.strip.done')}
              </button>
            ) : null}
          </li>
        );
      })}
      {steps.map(({ task, place }) => (
        <Step key={task.id} task={task} place={place.name} across={across} now={now} />
      ))}
    </ul>
  );
}

/** What a step confirmed moves: the plan, the targets it writes to the device, and the phase of the grow. */
const stepMoved = (client: QueryClient) => void planMoved(client);

/**
 * A plan step waiting for its word: the row is the step by its name, said to
 * be the grow plan's, with "Bestätigen" beside it. Confirming sends the next
 * step's targets to the device and cannot be taken back, so it asks first;
 * once it has landed the plan and the devices are read again, so the targets'
 * row says the new step at once rather than on the next beat.
 */
function Step({ task, place, across, now }: { task: Task; place: string; across: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { complete } = useLog();
  const [asking, setAsking] = useState(false);

  return (
    <li className={styles.due}>
      <span className={styles.dueText}>
        {task.label}
        <span className={styles.dueNote}>
          <Facts facts={[t('tasks.planStep'), across ? place : dueLabel(t, task.dueAt, now, zone, { since: true })]} />
        </span>
      </span>
      {asking ? null : (
        <button
          type="button"
          className={styles.dueAction}
          aria-label={t('tasks.planStepTitle', { label: task.label })}
          onClick={() => setAsking(true)}
        >
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
              complete(task.id, tickedLabel(t, task, across ? place : null), { undoable: false, changed: stepMoved });
            }}
            onCancel={() => setAsking(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
