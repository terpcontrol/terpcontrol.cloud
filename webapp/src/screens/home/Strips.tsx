import { Circle, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DueTask, FollowedGrowCard, HomeSpaceCard } from '@fg2/shared-types/v1';
import { mediaUrl } from '@/api/session';
import { useLog, useMayLog } from '@/log/log-context';
import { ageLabel } from '@/ui/age';
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
              <strong>{task.label}</strong> · {card.grow?.name ?? card.name}
            </span>
            <span className={`mono ${styles.chipMeta}`}>{dueLabel(t, task, now)}</span>
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

/** What the toast will say the tick wrote: the line, not the task - "Watered · Spring run". */
const doneLabel = (t: Translate, task: DueTask, card: HomeSpaceCard): string =>
  `${t(`home.entryKind.${task.kind === 'chore' || task.kind === 'custom' ? 'note' : task.kind}`)} · ${card.grow?.name ?? card.name}`;

/** "today", "tomorrow", or how overdue. */
const dueLabel = (t: Translate, task: DueTask, now: DateTime): string => {
  const days = Math.floor(DateTime.fromISO(task.dueAt).startOf('day').diff(now.startOf('day'), 'days').days);
  if (days < 0) return t('home.strip.overdue', { count: -days });
  if (days === 0) return t('home.strip.today');
  return t('home.strip.tomorrow');
};

export function FollowingStrip({ grows, now }: { grows: FollowedGrowCard[]; now: DateTime }) {
  const { t } = useTranslation();
  if (grows.length === 0) return null;

  return (
    <section className={styles.following} aria-label={t('home.strip.following')}>
      <header className={styles.followingHeader}>
        <span className="label">{t('home.strip.following')}</span>
      </header>
      <ul className={styles.tiles}>
        {grows.map(grow => {
          const cover = grow.coverMediaId ? mediaUrl(grow.coverMediaId) : null;
          return (
            <li key={grow.growId} className={styles.tile}>
              <span className={styles.tileCover}>
                {cover ? <img src={cover} alt="" loading="lazy" /> : <Leaf size={22} strokeWidth={1.5} aria-hidden />}
              </span>
              <span className={styles.tileTitle}>
                @{grow.handle} · {grow.name}
              </span>
              <span className={`mono ${styles.tileMeta}`}>
                {grow.dayNumber !== null ? `${t('home.card.dayN', { day: grow.dayNumber })} · ` : ''}
                {grow.stage ? `${t(`home.stage.${grow.stage}`)} · ` : ''}
                {t('home.card.ago', { age: ageLabel(grow.updatedAt, now) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
