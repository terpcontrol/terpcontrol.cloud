import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowCard } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { dayStamp } from '@/ui/age';
import { Facts } from '@/ui/Facts';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { growDay, useGrowWords } from '@/screens/grow/progress';
import { ownPhotoOf } from './place';
import styles from './Start.module.css';

/**
 * The grow as a row that leads to it, where no camera's picture heads it: its
 * name, and under it its day, its phase and week and what is left. A grow kept
 * by hand shows its newest photo beside it as a thumbnail, and failing that its
 * cover; the figures are read first, so the picture is never the head of the
 * page.
 */
export function GrowRow({ grow, to, entries = null }: { grow: GrowCard; to: string; entries?: Entry[] | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const { phase, left } = useGrowWords(grow);
  const photo = entries ? ownPhotoOf(entries, grow.growId) : null;
  const mediaId = entries ? (photo?.mediaIds[0] ?? grow.coverMediaId) : null;
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.still) : null;
  const taken = photo
    ? t(photo.authorId === user?.id ? 'start.picture.yours' : 'start.picture.photo', { day: dayStamp(photo.occurredAt, now, zone) })
    : null;

  return (
    <Link to={to} className={styles.lead}>
      {src ? <img className={styles.thumb} src={src} alt={t('start.picture.photoAlt', { name: grow.name })} /> : null}
      <span className={styles.leadText}>
        <span className={styles.leadName}>{grow.name}</span>
        <Facts className={styles.leadLine} facts={[growDay(t, grow), phase, left, taken]} />
      </span>
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );
}
