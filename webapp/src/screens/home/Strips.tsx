import { Circle, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DueTask, FollowedGrowCard, HomeSpaceCard } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, publicPicture } from '@/api/public';
import { useLog, useMayLog } from '@/log/log-context';
import { FollowButton } from '@/screens/public/FollowButton';
import { Photo } from '@/ui/Photo';
import { ageLabel } from '@/ui/age';
import { useZone } from '@/ui/zone';
import { daysUntil } from '@/screens/tasks/tasks';
import styles from './Strips.module.css';
import { alertLabel } from './units';

/**
 * The three strips around the cards. Each is there only while it has something
 * to say: an alert that is open, a task that is due, a grow that is followed.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function AttentionStrip({ cards, now }: { cards: HomeSpaceCard[]; now: DateTime }) {
  const { t } = useTranslation();
  const open = cards.flatMap(card => card.openAlerts.map(alert => ({ card, alert })));
  if (open.length === 0) return null;

  return (
    <ul className={styles.strip} aria-label={t('home.strip.attention')}>
      {open.map(({ card, alert }) => (
        <li key={alert.alertId}>
          <Link to="/alerts" className={`${styles.chip} ${styles.alert}`} data-severity={alert.severity}>
            <span className={styles.chipText}>
              <strong>{alertLabel(t, alert)}</strong> · {card.name}
            </span>
            <span className={`mono ${styles.chipMeta}`}>{t('home.card.ago', { age: ageLabel(alert.startedAt, now) })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DueStrip({ cards, now }: { cards: HomeSpaceCard[]; now: DateTime }) {
  const { t } = useTranslation();
  // "today" and "tomorrow" are the account's days, which is how the Tasks tab
  // groups the same rows; counted on the browser's calendar the two screens
  // disagree about what is waiting today.
  const zone = useZone();
  const { complete } = useLog();
  const mayLog = useMayLog();
  const due = cards.flatMap(card => card.dueTasks.map(task => ({ card, task }))).sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt));
  if (due.length === 0) return null;

  return (
    <ul className={styles.strip} aria-label={t('home.strip.due')}>
      {due.map(({ card, task }) => (
        <li key={task.id}>
          <div className={styles.chip}>
            <Circle size={16} strokeWidth={1.75} className={styles.circle} aria-hidden />
            <span className={styles.chipText}>
              <strong>{task.label}</strong> · {placeOf(task, card)}
            </span>
            <span className={`mono ${styles.chipMeta}`}>{dueLabel(t, task, now, zone)}</span>
            {/* Done writes the entry the task implies; the toast is where it can still be taken back. */}
            {mayLog ? (
              <button type="button" className={styles.done} onClick={() => complete(task.id, doneLabel(t, task, card))}>
                {t('home.strip.done')}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the task is about, by name. A task written against the grow is named
 * after the grow, and one written against the tent after the tent: cleaning
 * the carbon filter is the tent's chore and stays the tent's when the grow in
 * it is harvested.
 */
const placeOf = (task: DueTask, card: HomeSpaceCard): string => (task.subject.type === 'grow' ? (card.grow?.name ?? card.name) : card.name);

/** What the toast will say the tick wrote: the line, not the task - "Watered · Spring run". */
const doneLabel = (t: Translate, task: DueTask, card: HomeSpaceCard): string =>
  `${t(`home.entryKind.${task.kind === 'chore' || task.kind === 'custom' ? 'note' : task.kind}`)} · ${placeOf(task, card)}`;

/** "today", "tomorrow", "in 3 d", or how overdue - the words the Tasks tab counts a task down in, counted the way that tab counts them. */
const dueLabel = (t: Translate, task: DueTask, now: DateTime, zone: string | null): string => {
  const days = daysUntil(task.dueAt, now, zone);
  if (days < 0) return t('home.strip.overdue', { count: -days });
  if (days === 0) return t('home.strip.today');
  if (days === 1) return t('home.strip.tomorrow');
  return t('home.strip.inDays', { count: days });
};

/**
 * The diaries somebody keeps reading. Each tile is the public page it came
 * from - a followed grow is somebody else's, and its public address is the
 * whole of what a follower ever sees of it - with the way to stop beside it.
 *
 * A cover is fetched through the public route rather than with this session's
 * media token: the token is good for what the account may see, and a diary
 * somebody else made public is not that.
 */
export function FollowingStrip({ grows, now }: { grows: FollowedGrowCard[]; now: DateTime }) {
  const { t } = useTranslation();
  if (grows.length === 0) return null;

  return (
    <section className={styles.following} aria-label={t('home.strip.following')}>
      <header className={styles.followingHeader}>
        <span className="label">{t('home.strip.following')}</span>
      </header>
      <ul className={styles.tiles}>
        {grows.map(grow => (
          <FollowedTile key={grow.growId} grow={grow} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One followed grow, on the home strip and on the Following page alike: the
 * public page it came from, under its owner's handle, with the way to stop
 * beside it. It is a list item because both places are lists.
 */
export function FollowedTile({ grow, now }: { grow: FollowedGrowCard; now: DateTime }) {
  const { t } = useTranslation();
  const cover = grow.coverMediaId ? publicPicture(grow.slug)(grow.coverMediaId, PUBLIC_WIDTH.card) : null;

  return (
    <li className={styles.tile}>
      <Link to={`/g/${grow.slug}`} className={styles.tileLink}>
        <Photo src={cover} alt="" className={styles.tileCover} fallback={<Leaf size={22} strokeWidth={1.5} aria-hidden />} />
        <span className={styles.tileTitle}>
          @{grow.handle} · {grow.name}
        </span>
        <span className={`mono ${styles.tileMeta}`}>
          {grow.dayNumber !== null ? `${t('home.card.dayN', { day: grow.dayNumber })} · ` : ''}
          {grow.stage ? `${t(`home.stage.${grow.stage}`)} · ` : ''}
          {/* A diary that is over says so, and keeps its day number: that is
              the day it finished on. The age beside it is when its last line
              was written, which is a different date and no substitute. */}
          {grow.endedAt ? `${t('grow.ended', { date: DateTime.fromISO(grow.endedAt).toFormat('d LLL yyyy') })} · ` : ''}
          {t('home.card.ago', { age: ageLabel(grow.updatedAt, now) })}
        </span>
      </Link>
      <FollowButton growId={grow.growId} />
    </li>
  );
}
