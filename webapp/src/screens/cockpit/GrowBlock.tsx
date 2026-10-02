import { ChevronRight, Circle, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OverviewCamera, OverviewGrow, OverviewTask, SpaceOverview } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useLog, useMayLog } from '@/log/log-context';
import { ageLabel } from '@/ui/age';
import { authorOf, headlineOf } from '@/ui/entries';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { daysUntil } from '../tasks/tasks';
import { CameraPicture } from './CameraPicture';
import styles from './Cockpit.module.css';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The diary's part of a place, for whoever keeps one: the grow standing here
 * with its day and phase, the last line written about it, and what is due -
 * each with the Done that writes it. Where nothing grows here, the two ways to
 * change that, offered to somebody who may.
 *
 * Where a camera watches the place, its picture heads the block, large, with
 * the grow's day and phase on it: the tent and what grows in it are one thing
 * to look at, and the page shows the picture once rather than as a camera, a
 * grow's thumbnail and a photo line under each other.
 *
 * Without one, a grow is shown by the newest photo written into its diary.
 */
export function GrowBlock({
  overview,
  camera = null,
  still,
  now,
}: {
  overview: SpaceOverview;
  camera?: OverviewCamera | null;
  still: string | null;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const first = overview.grows[0] ?? null;
  const label = first
    ? [
        first.dayNumber !== null ? t('home.card.dayN', { day: first.dayNumber }) : null,
        first.stage
          ? `${t(`home.stage.${first.stage}`)}${first.stageWeek !== null ? ` ${t('home.card.week', { week: first.stageWeek })}` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section className={`${ui.card} ${styles.grow}`} aria-label={t('cockpit.grow.title')} data-pictured={camera ? true : undefined}>
      {camera ? <CameraPicture overview={overview} camera={camera} now={now} label={label} /> : null}
      {overview.grows.length === 0 ? (
        <NothingGrows overview={overview} />
      ) : (
        overview.grows.map(grow => (
          <GrowRow
            key={grow.growId}
            grow={grow}
            overview={overview}
            still={camera ? null : (still ?? photoOf(overview, grow.growId))}
            bare={camera !== null}
            now={now}
          />
        ))
      )}
      {overview.dueTasks.length > 0 ? (
        <ul className={styles.due} aria-label={t('cockpit.grow.due')}>
          {overview.dueTasks.map(task => (
            <DueRow key={task.id} task={task} overview={overview} now={now} />
          ))}
        </ul>
      ) : null}
      <Link to="/tasks" className={`mono ${ui.headLink} ${styles.allTasks}`}>
        {t('cockpit.grow.tasks')}
        <ChevronRight size={12} strokeWidth={2} aria-hidden />
      </Link>
    </section>
  );
}

function GrowRow({
  grow,
  overview,
  still,
  bare,
  now,
}: {
  grow: OverviewGrow;
  overview: SpaceOverview;
  still: string | null;
  /** Under the camera's picture the grow needs no thumbnail of its own. */
  bare: boolean;
  now: DateTime;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const coverId = grow.coverMediaId ?? still;
  const cover = coverId ? mediaUrl(coverId, THUMBNAIL_WIDTH.cover) : null;
  const newest = overview.entries.find(entry => entry.growId === grow.growId) ?? null;
  const phase = [
    grow.stage ? t(`home.stage.${grow.stage}`) : t('home.card.noPhase'),
    grow.stageWeek !== null ? t('home.card.week', { week: grow.stageWeek }) : null,
    grow.strains.length > 0 ? grow.strains.join(', ') : null,
  ].filter(Boolean);

  return (
    <Link to={`/grows/${grow.growId}`} className={styles.growRow}>
      {bare ? null : <span className={styles.cover}>{cover ? <img src={cover} alt="" /> : <Leaf size={20} strokeWidth={1.5} aria-hidden />}</span>}
      <span className={styles.growText}>
        <span className={styles.growName}>
          {grow.name}
          {grow.dayNumber !== null ? <span className={`figure ${styles.growDay}`}>{t('home.card.dayN', { day: grow.dayNumber })}</span> : null}
        </span>
        <span className={styles.growLine}>
          {phase.join(' · ')}
          {grow.isAuto ? <span className={`mono ${styles.auto}`}>{t('home.card.auto')}</span> : null}
        </span>
        <span className={`mono ${styles.growLine}`}>
          {newest
            ? t('cockpit.grow.lastEntry', {
                what: headlineOf(t, i18n, newest),
                age: ageLabel(newest.occurredAt, now),
                who: authorOf(t, newest, overview.people, user?.id),
              })
            : t('home.card.noEntries')}
        </span>
      </span>
      <ChevronRight size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden />
    </Link>
  );
}

/** The newest photo written into a grow's diary that the page has, which a grow with no camera is shown by. */
const photoOf = (overview: SpaceOverview, growId: string): string | null =>
  overview.entries.find(entry => entry.growId === growId && entry.cameraId === null && entry.mediaIds.length > 0)?.mediaIds[0] ?? null;

/** Nothing grows here: the two ways to change that, to somebody who may put a grow into this place. */
function NothingGrows({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(overview.spaceId);
  const [moving, setMoving] = useState(false);

  return (
    <div className={styles.nothingGrows}>
      <p className={ui.note}>{t('home.invite.noGrow')}</p>
      {mayManage ? (
        <p className={`${styles.growActions} ${ui.dots}`}>
          <Link to={`/grows/new?space=${overview.spaceId}`} className={ui.headLink}>
            {t('home.invite.startGrow')}
          </Link>
          <span className={ui.dot}>
            {' · '}
            <button type="button" className={ui.headLink} onClick={() => setMoving(true)}>
              {t('home.invite.moveGrow')}
            </button>
          </span>
        </p>
      ) : null}
      {moving ? <MoveHereSheet spaceId={overview.spaceId} spaceName={overview.name} onClose={() => setMoving(false)} /> : null}
    </div>
  );
}

/** A task that is due, with the Done that writes the line it stands for and says so in the toast. */
function DueRow({ task, overview, now }: { task: OverviewTask; overview: SpaceOverview; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { complete } = useLog();
  const mayLog = useMayLog();
  const subject = task.subject.type === 'grow' ? (overview.grows.find(grow => grow.growId === task.subject.id)?.name ?? '') : overview.name;
  const writes = t(`home.entryKind.${task.kind === 'chore' || task.kind === 'custom' ? 'note' : task.kind}`);

  return (
    <li className={styles.dueRow}>
      <Circle size={15} strokeWidth={1.75} className={styles.dueCircle} aria-hidden />
      <span className={styles.dueText}>
        <span>{task.label}</span>
        <span className={`mono ${styles.dueMeta}`}>{dueLabel(t, task.dueAt, now, zone)}</span>
      </span>
      {mayLog ? (
        <button type="button" className={`${ui.button} ${styles.done}`} onClick={() => complete(task.id, `${writes} · ${subject}`)}>
          {t('home.strip.done')}
        </button>
      ) : null}
    </li>
  );
}

/**
 * "today", "tomorrow", "in 3 d", or how overdue, counted on the account's
 * calendar as the Tasks tab counts. A task due today whose hour has passed
 * says since when, rather than "today" an hour after it fell due.
 */
const dueLabel = (t: Translate, dueAt: string, now: DateTime, zone: string | null): string => {
  const days = daysUntil(dueAt, now, zone);
  if (days < 0) return t('home.strip.overdue', { count: -days });
  if (days === 0 && DateTime.fromISO(dueAt) < now) return t('home.strip.dueSince', { time: clock(dueAt, zone) });
  if (days === 0) return t('home.strip.today');
  if (days === 1) return t('home.strip.tomorrow');
  return t('home.strip.inDays', { count: days });
};
