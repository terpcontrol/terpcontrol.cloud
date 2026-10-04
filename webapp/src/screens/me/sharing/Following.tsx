import { useTranslation } from 'react-i18next';
import { useHome } from '@/api/home';
import { useSession } from '@/api/session';
import { FollowedTile } from '@/screens/home/Strips';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { Page, SectionHead } from './Page';
import styles from './sharing.module.css';

/**
 * Me › Following: the diaries this account keeps reading, each with whose it
 * is and where it stands, and the way to stop.
 *
 * The tiles are the home strip's own, because a followed grow is the same
 * thing on both screens - somebody else's public page - and the button on each
 * is the one that follows and unfollows everywhere. What differs is only that
 * here the list is the page, so it fills the column instead of scrolling past
 * the edge of a strip.
 */
export function Following() {
  const { t } = useTranslation();
  const { user } = useSession();
  const title = t('me.following.title');

  if (user?.isDemo) {
    return (
      <Page title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.following.demo')}</p>
      </Page>
    );
  }

  return (
    <Page title={title}>
      <Followed />
    </Page>
  );
}

function Followed() {
  const { t } = useTranslation();
  const now = useNow();
  const home = useHome();

  if (home.isPending) return <Waiting lines={3} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  const grows = home.data.followedGrows;

  return (
    <>
      <RefreshFailed failedAt={home.isError ? home.dataUpdatedAt : null} now={now} />
      <SectionHead label={t('home.strip.following')} count={t('me.following.count', { count: grows.length })} />
      {grows.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.following.none')}</p>
      ) : (
        <ul className={styles.tiles} aria-label={t('home.strip.following')}>
          {grows.map(grow => (
            <FollowedTile key={grow.growId} grow={grow} now={now} />
          ))}
        </ul>
      )}
      <p className={`${ui.note} ${styles.closing}`}>{t('me.following.note')}</p>
    </>
  );
}
