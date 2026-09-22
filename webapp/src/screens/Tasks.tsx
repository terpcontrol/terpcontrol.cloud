import type { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Reminder, Task } from '@fg2/shared-types/v1';
import { useGrows } from '@/api/grows';
import { useReminders } from '@/api/reminders';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { useTasks } from '@/api/tasks';
import { useLog, useMayLog } from '@/log/log-context';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { ReminderSheet } from './tasks/ReminderSheet';
import { DoneCard, TaskCard } from './tasks/TaskCard';
import {
  dateLabel,
  dayLabel,
  GROUPS,
  groupOf,
  isMine,
  newestFirst,
  reminderOf,
  storedScope,
  storeScope,
  subjectName,
  type Scope,
} from './tasks/tasks';
import styles from './tasks/Tasks.module.css';

const SCOPES: Scope[] = ['mine', 'all'];

/**
 * The fifth tab: everything that is waiting to be done, in the order it is
 * waiting, and what was ticked off lately.
 *
 * The list is the server's - a task is what a reminder's rhythm says is due
 * and what a plan step is waiting to be told, worked out on every read - so
 * nothing here decides what is due; this screen only sorts what it was told
 * into today, tomorrow and later, by the reader's own calendar. Ticking one
 * off writes the diary line it implies through the same queue the Log sheet
 * uses, which is where it can still be taken back.
 *
 * What is waiting is the read the screen stands or falls by. The ticks, the
 * rhythms and the names of the places are read beside it, and a card is drawn
 * without them rather than the screen waiting for all four.
 */
export function Tasks() {
  const now = useNow();
  const waiting = useTasks(false);

  useReportFreshness(waiting.dataUpdatedAt ? new Date(waiting.dataUpdatedAt).toISOString() : null);

  if (waiting.isPending) {
    return (
      <section className={styles.page}>
        <Head />
        <Waiting />
      </section>
    );
  }

  if (!waiting.data) {
    return (
      <section className={styles.page}>
        <Head />
        <LoadFailed retry={() => void waiting.refetch()} />
      </section>
    );
  }

  return <List tasks={waiting.data.items} failedAt={waiting.isError ? waiting.dataUpdatedAt : null} now={now} />;
}

function Head({ scope, onScope }: { scope?: Scope; onScope?: (scope: Scope) => void }) {
  const { t } = useTranslation();

  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('tasks.title')}</h1>
      {scope && onScope ? (
        <div className={styles.segments} role="radiogroup" aria-label={t('tasks.scopeLabel')}>
          {SCOPES.map(one => (
            <button key={one} type="button" role="radio" aria-checked={scope === one} className={styles.segment} onClick={() => onScope(one)}>
              {t(`tasks.scope.${one}`)}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/**
 * Why there is nothing to show, which is three different things.
 *
 * The demo reads somebody else's account and the server answers it no task list
 * at all, so it is told that rather than told that account has nothing to do.
 * A list that is empty only because it is filtered says how much the filter is
 * hiding and offers to drop it - "nothing is due" while the club's chores are
 * overdue is simply untrue.
 */
function Nothing({ demo, waiting, onAll }: { demo: boolean; waiting: number; onAll: () => void }) {
  const { t } = useTranslation();

  if (demo) {
    return (
      <div className={`${ui.cardDashed} ${styles.none}`}>
        <p className={ui.note}>{t('tasks.demoNoList')}</p>
      </div>
    );
  }

  if (waiting > 0) {
    return (
      <button type="button" className={`${ui.cardDashed} ${styles.none}`} onClick={onAll}>
        <span className={ui.note}>{t('tasks.nothingForYou', { count: waiting })}</span>
      </button>
    );
  }

  return (
    <div className={`${ui.cardDashed} ${styles.none}`}>
      <p className={ui.note}>{t('tasks.nothingDue')}</p>
    </div>
  );
}

function List({ tasks, failedAt, now }: { tasks: Task[]; failedAt: number | null; now: DateTime }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { complete } = useLog();
  const mayLog = useMayLog();
  const mayManage = useMayManage();
  const done = useTasks(true);
  const reminders = useReminders();
  const grows = useGrows();
  const spaces = useSpaces();
  const [scope, setScope] = useState<Scope>(storedScope);
  /** The sheet: closed, open on a new rhythm, or open on the one behind a card. */
  const [editing, setEditing] = useState<{ reminder: Reminder | null } | null>(null);
  /**
   * The same function for as long as the sheet is open. The clock above this
   * screen re-renders it every ten seconds, and a sheet handed a new closer on
   * every one of those re-opens itself - taking the focus out of whatever field
   * was being typed in.
   */
  const closeSheet = useCallback(() => setEditing(null), []);

  const pickScope = (next: Scope) => {
    setScope(next);
    storeScope(next);
  };

  const shown = scope === 'all' ? tasks : tasks.filter(task => isMine(task, user?.id ?? null));
  const ticked = newestFirst((done.data?.items ?? []).filter(task => scope === 'all' || isMine(task, user?.id ?? null)));
  const nameOf = (task: Task) => subjectName(task.subject, grows.data?.items, spaces.data?.items);
  const openGrows = (grows.data?.items ?? []).filter(grow => grow.endedAt === null);

  /**
   * What the toast says the tick wrote: the line, not the task - "Watered ·
   * Spring run". A plan step writes a line too, but what it really did is move
   * the plan on, and the toast says that rather than naming a diary entry
   * nobody was writing.
   */
  const doneLabel = (task: Task) => {
    const kind = task.kind === 'chore' || task.kind === 'custom' ? 'note' : task.kind;
    const what = task.source === 'plan_step' ? t('tasks.stepConfirmed') : t(`home.entryKind.${kind}`);
    const name = nameOf(task);
    return name ? `${what} · ${name}` : what;
  };

  /**
   * Ticking a plan step tells the plan to go on: the next step becomes the
   * running one and its targets leave for the controller. Deleting the diary
   * line afterwards would take back the note and leave the plan where the tick
   * put it, so no Undo is offered for one; the plan itself is where a step is
   * moved back.
   */
  const tick = (task: Task) => complete(task.id, doneLabel(task), { undoable: task.source !== 'plan_step' });

  return (
    <section className={styles.page}>
      <Head scope={scope} onScope={pickScope} />
      <RefreshFailed failedAt={failedAt} now={now} />

      {shown.length === 0 ? <Nothing demo={user?.isDemo === true} waiting={tasks.length} onAll={() => pickScope('all')} /> : null}

      {GROUPS.map(group => {
        const members = shown.filter(task => groupOf(task, now) === group);
        if (members.length === 0) return null;

        return (
          <section key={group} className={styles.group} aria-label={t(`tasks.group.${group}`)}>
            <header className={styles.groupHead}>
              <span className="label">{t(`tasks.group.${group}`)}</span>
              {group === 'today' ? <span className={`mono ${styles.groupAside}`}>{dateLabel(now, i18n.language)}</span> : null}
            </header>
            <ul className={styles.cards}>
              {members.map(task => {
                const reminder = reminderOf(task, reminders.data?.items);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    name={nameOf(task)}
                    reminder={reminder}
                    me={user}
                    now={now}
                    onDone={mayLog ? () => tick(task) : null}
                    onEdit={mayManage && reminder ? () => setEditing({ reminder }) : null}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {ticked.length > 0 ? (
        <section className={styles.group} aria-label={t('tasks.group.done')}>
          <header className={styles.groupHead}>
            <span className="label">{t('tasks.group.done')}</span>
            <span className={`mono ${styles.groupAside}`}>{dayLabel(t, ticked[0].completion?.occurredAt ?? now.toISO()!, now, i18n.language)}</span>
          </header>
          <ul className={styles.cards}>
            {ticked.map(task => (
              <DoneCard key={task.id} task={task} name={nameOf(task)} me={user} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      <p className={ui.note}>{t('tasks.sources')}</p>

      {mayManage ? (
        <button type="button" className={`${ui.cardDashed} ${styles.add}`} onClick={() => setEditing({ reminder: null })}>
          {t('tasks.add')}
        </button>
      ) : null}

      {editing && user ? (
        <ReminderSheet reminder={editing.reminder} grows={openGrows} spaces={spaces.data?.items ?? []} userId={user.id} onClose={closeSheet} />
      ) : null}
    </section>
  );
}
