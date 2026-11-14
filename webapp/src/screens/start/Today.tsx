import type { QueryClient } from '@tanstack/react-query';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { planMoved } from '@/api/plans';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { useZone } from '@/ui/zone';
import { dueLabel, tickedLabel } from '@/screens/tasks/tasks';
import { useDue, type Due } from './due';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

/**
 * "Heute": what is due for the reader today or overdue, each with the one tap
 * that settles it. Nothing is drawn while nothing is due. One place of
 * several lists its own; the Start of everything lists all of it, and with
 * several places a row says where before it says since when.
 */
export function Today({ spaceId, now }: { spaceId?: string; now: DateTime }) {
  const { t } = useTranslation();
  const due = useDue(now);
  const rows = spaceId && due.across ? due.rows.filter(one => one.spaceId === spaceId) : due.rows;
  if (rows.length === 0) return null;

  return (
    <section className={`${ui.panel} ${styles.card}`} aria-labelledby="start-today">
      <h2 className={`${ui.cardHeading} ${styles.cardTitle}`} id="start-today">
        {t('start.today.title')}
      </h2>
      <DueList rows={rows} across={!spaceId && due.across} now={now} />
    </section>
  );
}

/** The rows of what is due - on Start under "Heute", behind the bell under "Aufgaben". */
export function DueList({ rows, across, now }: { rows: Due[]; across: boolean; now: DateTime }) {
  return (
    <ul className={styles.rows}>
      {rows.map(one => (
        <Row key={one.task.id} {...one} across={across} now={now} />
      ))}
    </ul>
  );
}

/** What a step confirmed moves: the plan, the targets it writes to the device, and the phase of the grow. */
const stepMoved = (client: QueryClient) => void planMoved(client);

/**
 * One task with its tap. A watering or a feeding is something to enter - how
 * much, what - so it opens the entry sheet on that kind, and the line written
 * there closes the task; a chore has nothing to enter and is ticked off, and
 * the toast names it. A step of the grow plan is said to be the plan's and
 * asks first: confirming sends the next step's targets to the device and
 * cannot be taken back. Once it has landed the plan and the devices are read
 * again, so the targets' row says the new step at once.
 */
function Row({ task, spaceId, where, growId, twin, across, now }: Due & { across: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { openSheet, complete } = useLog();
  const [asking, setAsking] = useState(false);
  const step = task.source === 'plan_step';
  const enters = !step && growId !== null && (task.kind === 'water' || task.kind === 'feed');
  const verb = t(step ? 'start.today.confirm' : enters ? 'start.today.enter' : 'home.strip.done');
  const told = tickedLabel(t, task, across || twin ? where[0] : null);
  const act = () => {
    if (step) setAsking(true);
    else if (enters) openSheet({ growId, spaceId, kind: task.kind as 'water' | 'feed', taskId: task.id });
    else complete(task.id, told);
  };

  return (
    <li className={styles.due}>
      <span className={styles.dueText}>
        {task.label}
        <span className={styles.dueNote}>
          <Facts
            facts={[
              step && t('tasks.planStep'),
              ...(across ? where : twin ? where.slice(0, 1) : []),
              dueLabel(t, task.dueAt, now, zone, { since: true }),
            ]}
          />
        </span>
      </span>
      {asking ? (
        <div className={styles.dueAsk}>
          <Asking
            note={t('tasks.confirm.askUnnamed')}
            yes={t('tasks.confirm.yes')}
            busy={false}
            onYes={() => {
              setAsking(false);
              complete(task.id, told, { undoable: false, changed: stepMoved });
            }}
            onCancel={() => setAsking(false)}
          />
        </div>
      ) : (
        <button type="button" className={`${ui.pill} ${styles.dueAction}`} aria-label={`${verb}: ${task.label}`} onClick={act}>
          {verb}
        </button>
      )}
    </li>
  );
}
