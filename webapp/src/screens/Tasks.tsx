import type { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Reminder, Task } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useRoomsMembers } from '@/api/members';
import { useReminders } from '@/api/reminders';
import { useSession } from '@/api/session';
import { useTasks } from '@/api/tasks';
import { useLog } from '@/log/log-context';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { nowThere, useZone } from '@/ui/zone';
import { PageHead } from '@/ui/PageHead';
import { useSubjects } from './start/due';
import { ReminderSheet } from './tasks/ReminderSheet';
import { DoneCard, RhythmCard, TaskCard } from './tasks/TaskCard';
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
  tickedLabel,
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

/**
 * The title, with the way back to Meldungen, where the list is reached: no item of the bar is this page's own.
 * What the list holds is behind the help button - not for the demo, which is answered no list.
 */
function Head({ scope, onScope }: { scope?: Scope; onScope?: (scope: Scope) => void }) {
  const { t } = useTranslation();
  const { user } = useSession();

  return (
    <PageHead back={{ to: '/alerts', label: t('alerts.back') }} title={t('tasks.title')}>
      {user?.isDemo ? null : <Help topic="tasks" />}
      {scope && onScope ? (
        <div className={`${ui.segments} ${styles.scope}`} role="radiogroup" aria-label={t('tasks.scopeLabel')}>
          {SCOPES.map(one => (
            <button key={one} type="button" role="radio" aria-checked={scope === one} className={ui.segment} onClick={() => onScope(one)}>
              {t(`tasks.scope.${one}`)}
            </button>
          ))}
        </div>
      ) : null}
    </PageHead>
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
  // Which day a task falls on is decided where the account is: a list read two
  // zones from it otherwise files this evening's work under tomorrow and heads
  // the day with the browser's date.
  const zone = useZone();
  const { user } = useSession();
  const { complete } = useLog();
  const mayManage = useMayManage();
  // Where a card's subject stands decides who may act on it: this list gathers tasks from every place at once.
  const { grows, spaces, standingOf, mayOn, mayTick, nameOf } = useSubjects();
  const done = useTasks(true);
  const reminders = useReminders();
  const devices = useDevices();
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

  // "Mine" and "all" are the same list until somebody else is given a task:
  // somebody keeping a diary alone was asked to choose between two answers to one question.
  const myId = user?.id ?? null;
  const shared = [...tasks, ...(done.data?.items ?? [])].some(task => task.assigneeId !== null && task.assigneeId !== myId);
  const shown = scope === 'all' || !shared ? tasks : tasks.filter(task => isMine(task, myId));
  const ticked = newestFirst((done.data?.items ?? []).filter(task => scope === 'all' || !shared || isMine(task, myId)));
  // Who ticked what somebody else did, by the people of the place it was done in: read only where there is such a tick.
  const byOthers = ticked.filter(task => task.completion?.authorId && task.completion.authorId !== myId);
  const members = useRoomsMembers([...new Set(byOthers.flatMap(task => standingOf(task.subject)?.spaceId ?? []))]);
  const tickedBy = (task: Task): string | null =>
    [...members.values()].flatMap(page => page?.people ?? []).find(person => person.id === task.completion?.authorId)?.handle ?? null;

  /** The places a rhythm can be hung on: a reminder is `manage` on its subject, so nothing else may be offered. */
  const reminderGrows = (grows ?? []).filter(grow => grow.endedAt === null && mayOn({ type: 'grow', id: grow.id }, 'manage'));
  const reminderSpaces = (spaces ?? []).filter(space => enough(space.youMay, 'manage'));

  // A rhythm is what repeats; a one-off stands under its day, and here only while that day is beyond the board.
  const rhythms = [...(reminders.data?.items ?? [])]
    .filter(reminder => reminder.everyDays !== null || !tasks.some(task => task.id === reminder.id))
    .sort((one, other) => one.label.localeCompare(other.label));

  /**
   * The controller whose plan a step belongs to, so that the card can say what
   * confirming it will start. The task names the space, and the plan is the
   * device's, so the device standing there is the one to ask; where a place
   * holds more than one, the card falls back to naming no step rather than the
   * screen guessing which of them is being run by a plan.
   */
  const deviceOf = (task: Task): string | null => {
    if (task.source !== 'plan_step' || task.subject.type !== 'space') return null;
    const here = (devices.data?.items ?? []).filter(device => device.spaceId === task.subject.id);
    return here.length === 1 ? here[0].id : null;
  };

  /** What the toast says: the task that was ticked, by its own name, and where (`tickedLabel`). */
  const doneLabel = (task: Task) => tickedLabel(t, task, nameOf(task.subject));

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
      <Head scope={shared ? scope : undefined} onScope={pickScope} />
      <RefreshFailed failedAt={failedAt} now={now} />

      {shown.length === 0 ? <Nothing demo={user?.isDemo === true} waiting={tasks.length} onAll={() => pickScope('all')} /> : null}

      {GROUPS.map(group => {
        const members = shown.filter(task => groupOf(task, now, zone) === group);
        if (members.length === 0) return null;

        return (
          <section key={group} className={`${ui.stack2} ${styles.group}`} aria-label={t(`tasks.group.${group}`)}>
            <header className={ui.headRow}>
              <span className="label">{t(`tasks.group.${group}`)}</span>
              {group === 'today' ? <span className={`mono ${styles.groupAside}`}>{dateLabel(nowThere(now, zone), i18n.language)}</span> : null}
            </header>
            <ul className={ui.group}>
              {members.map(task => {
                const reminder = reminderOf(task, reminders.data?.items);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    name={nameOf(task.subject)}
                    reminder={reminder}
                    deviceId={deviceOf(task)}
                    me={user}
                    now={now}
                    onDone={mayTick(task) ? () => tick(task) : null}
                    onEdit={mayOn(task.subject, 'manage') && reminder ? () => setEditing({ reminder }) : null}
                    why={task.source === 'plan_step' && !mayTick(task) ? t('tasks.stepIsManaged') : null}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {ticked.length > 0 ? (
        <section className={`${ui.stack2} ${styles.group}`} aria-label={t('tasks.group.done')}>
          <header className={ui.headRow}>
            <span className="label">{t('tasks.group.done')}</span>
            <span className={`mono ${styles.groupAside}`}>
              {dayLabel(t, ticked[0].completion?.occurredAt ?? now.toISO()!, now, i18n.language, zone)}
            </span>
          </header>
          <ul className={ui.group}>
            {ticked.map(task => (
              <DoneCard key={task.id} task={task} name={nameOf(task.subject)} by={tickedBy(task)} me={user} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* The rhythms themselves, and not only their turns inside the week the list looks over:
          one that comes round every thirty days can be read, corrected and stopped in between. */}
      {rhythms.length > 0 ? (
        <section className={`${ui.stack2} ${styles.group}`} aria-label={t('tasks.group.rhythms')}>
          <header className={ui.headRow}>
            <span className="label">
              {t('tasks.group.rhythms')}
              <Help topic="rhythms" />
            </span>
            <span className={`mono ${styles.groupAside}`}>{t('tasks.rhythmsAside')}</span>
          </header>
          <ul className={ui.group}>
            {rhythms.map(reminder => (
              <RhythmCard
                key={reminder.id}
                reminder={reminder}
                name={nameOf(reminder.subject)}
                language={i18n.language}
                onEdit={mayOn(reminder.subject, 'manage') ? () => setEditing({ reminder }) : null}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* A rhythm has to hang on a grow or a place this account manages; with
          none of either there is nothing the sheet could write. */}
      {mayManage && (reminderGrows.length > 0 || reminderSpaces.length > 0) ? (
        <button type="button" className={`${ui.cardDashed} ${styles.add}`} onClick={() => setEditing({ reminder: null })}>
          {t('tasks.add')}
        </button>
      ) : null}

      {editing && user ? (
        <ReminderSheet reminder={editing.reminder} grows={reminderGrows} spaces={reminderSpaces} userId={user.id} onClose={closeSheet} />
      ) : null}
    </section>
  );
}
