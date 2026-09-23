import { Archive, ChevronLeft, ChevronRight, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, Space } from '@fg2/shared-types/v1';
import { useEveryGrow } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './Archive.module.css';

/**
 * The archive: every grow of this account that has ended, newest first.
 *
 * Ending a grow is an ordinary move - the sheet that offers it says it archives
 * the diary - and until this screen existed it was also the move that made the
 * diary unreachable. The home draws a card per place and a place holds the grow
 * standing in it now; the tent page lists the same; and the one list that does
 * carry a finished grow, "Move a grow here", deliberately leaves it out. A
 * grower who finished a grow in the app was left with the address bar.
 *
 * It is an account-level list rather than a section of a tent, because a grow
 * can end while it stands in no place at all, and because the tent it stood in
 * may since have been deleted - both of which would leave exactly the hole this
 * screen closes. The list is read to the last page for the same reason: a grow
 * that merely sorts past the first page is not a grow that is gone, and where
 * the cursor ran out before the grows did the screen says so instead of letting
 * the missing ones read as none.
 */
export function GrowArchive() {
  const { t } = useTranslation();
  const now = useNow();
  const grows = useEveryGrow();
  const spaces = useSpaces();

  if (grows.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  if (!grows.data) return <LoadFailed retry={() => void grows.refetch()} />;

  const ended = grows.data.items
    .filter((grow): grow is GrowListItem & { endedAt: string } => grow.endedAt !== null)
    .sort((one, other) => other.endedAt.localeCompare(one.endedAt));

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link to="/" className={styles.back} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.title}>{t('grow.archive.title')}</h1>
        <span className={`mono ${styles.count}`}>{t('grow.archive.count', { count: ended.length })}</span>
      </header>

      <RefreshFailed failedAt={grows.isError ? grows.dataUpdatedAt : null} now={now} />

      {ended.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.archive.none')}</p>
      ) : (
        <ul className={styles.rows}>
          {ended.map(grow => (
            <ArchiveRow key={grow.id} grow={grow} spaces={spaces.data?.items ?? []} />
          ))}
        </ul>
      )}

      {/* Said rather than hidden: the cap on how far a list is read exists so a
          huge account cannot hold the screen open, and a reader who stopped at
          it has to know that what is missing may still be there. */}
      {grows.data.complete ? null : <p className={`mono ${ui.note}`}>{t('grow.archive.partial')}</p>}
    </section>
  );
}

/**
 * One finished grow: what it was called, the span it ran over, how long it
 * lasted and where it stood while it did.
 *
 * The place comes from the placements rather than from where the plants are
 * now, because a grow that has ended has no plants anywhere - which is the same
 * reason its own header has to reach for the closed placement.
 */
function ArchiveRow({ grow, spaces }: { grow: GrowListItem & { endedAt: string }; spaces: Space[] }) {
  const { t } = useTranslation();
  const cover = grow.coverMediaId ? mediaUrl(grow.coverMediaId, THUMBNAIL_WIDTH.cover) : null;
  const day = (at: string) => DateTime.fromISO(at).toFormat('d LLL yyyy');
  const where = [...new Set(grow.placements.map(placement => placement.spaceId))]
    .map(spaceId => (spaceId === null ? t('grow.noFixedPlace') : (spaces.find(space => space.id === spaceId)?.name ?? null)))
    .filter((name): name is string => name !== null);

  return (
    <li>
      <Link to={`/grows/${grow.id}/weeks`} className={`${ui.card} ${styles.row}`}>
        <span className={styles.cover}>{cover ? <img src={cover} alt="" loading="lazy" /> : <Leaf size={22} strokeWidth={1.5} aria-hidden />}</span>
        <span className={styles.text}>
          <span className={styles.name}>{grow.name}</span>
          <span className={`mono ${styles.meta}`}>
            {t('publicPage.ran', { from: day(grow.startedAt), to: day(grow.endedAt) })}
            {grow.summary.dayNumber !== null ? ` · ${t('grow.days', { count: grow.summary.dayNumber })}` : ''}
            {grow.summary.stage ? ` · ${t(`home.stage.${grow.summary.stage}`)}` : ''}
            {where.length > 0 ? ` · ${where.join(', ')}` : ''}
          </span>
        </span>
        <ChevronRight size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * The way from the home to the diaries that are over.
 *
 * It sits under the cards, beside the row that starts a grow, because those are
 * the two things about grows that the places above them cannot say: one is not
 * begun yet, the other is finished. A finished grow is on no card - the home
 * draws a place and what stands in it now - so without this row the only way
 * back into it is its address.
 *
 * It appears only once there is something behind it, which is the home's own
 * rule for its strips. The read it costs is the list of grows the sheets that
 * move one already ask for, so it is shared with them rather than added to
 * them.
 */
export function ArchiveLink() {
  const { t } = useTranslation();
  const grows = useEveryGrow();
  const count = grows.data?.items.filter(grow => grow.endedAt !== null).length ?? 0;

  if (count === 0) return null;

  return (
    <Link to="/grows/archive" className={styles.link}>
      <Archive size={14} strokeWidth={1.75} aria-hidden />
      {t('grow.archive.title')}
      <span className="mono">{t('grow.archive.count', { count })}</span>
    </Link>
  );
}
