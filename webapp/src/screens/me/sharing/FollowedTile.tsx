import { Leaf } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Link } from 'react-router';
import type { FollowedGrowCard } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, publicPicture } from '@/api/public';
import { followedMeta } from '@/screens/public/followed';
import { FollowButton } from '@/screens/public/FollowButton';
import { Photo } from '@/ui/Photo';
import { useTranslation } from 'react-i18next';
import { useZone } from '@/ui/zone';
import styles from './FollowedTile.module.css';
import ui from '@/ui/ui.module.css';

/**
 * One followed grow: the public page it came from, under its owner's handle,
 * with the way to stop beside it. A followed grow is somebody else's, and its
 * public address is the whole of what a follower ever sees of it.
 *
 * The cover is fetched through the public route rather than with this
 * session's media token: the token is good for what the account may see, and
 * a diary somebody else made public is not that.
 */
export function FollowedTile({ grow, now }: { grow: FollowedGrowCard; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const cover = grow.coverMediaId ? publicPicture(grow.slug)(grow.coverMediaId, PUBLIC_WIDTH.card) : null;

  return (
    <li className={styles.tile}>
      <Link to={`/g/${grow.slug}`} className={`${ui.stack1} ${styles.tileLink}`}>
        <Photo src={cover} alt="" className={styles.tileCover} fallback={<Leaf size={22} strokeWidth={1.5} aria-hidden />} />
        <span className={styles.tileTitle}>
          @{grow.handle} · {grow.name}
        </span>
        <span className={`mono ${styles.tileMeta}`}>{followedMeta(t, grow, now, zone)}</span>
      </Link>
      <FollowButton growId={grow.growId} />
    </li>
  );
}
