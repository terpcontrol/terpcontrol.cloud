import { useTranslation } from 'react-i18next';
import { useHome } from '@/api/home';
import { LoadFailed, NothingHere, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { MePage } from '../parts';
import { FollowedTile } from './FollowedTile';
import { SectionHead } from './SectionHead';
import styles from './sharing.module.css';

/**
 * Me › Following: the diaries this account keeps reading, each with whose it
 * is and where it stands, and the way to stop.
 */
export function Following() {
  const { t } = useTranslation();

  return (
    <MePage title={t('me.following.title')} demo={t('me.following.demo')} grows>
      <Followed />
    </MePage>
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
      <SectionHead label={t('me.following.title')} count={t('me.following.count', { count: grows.length })} />
      {grows.length === 0 ? (
        <NothingHere>{t('me.following.none')}</NothingHere>
      ) : (
        <ul className={styles.tiles} aria-label={t('me.following.title')}>
          {grows.map(grow => (
            <FollowedTile key={grow.growId} grow={grow} now={now} />
          ))}
        </ul>
      )}
      <p className={`${ui.note} ${styles.closing}`}>{t('me.following.note')}</p>
    </>
  );
}
