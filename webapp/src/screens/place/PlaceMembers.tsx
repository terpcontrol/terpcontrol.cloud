import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { placePath } from '@/app/places';
import { useSpaces } from '@/api/spaces';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { useMayIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { BackLink } from '@/ui/BackLink';
import { Members } from '../space/members/Members';
import styles from './Place.module.css';

/**
 * Who else is let into a place, reached from the ⋯ beside its name, and the way
 * to a link that shows it to somebody without an account. It is a page below
 * the cockpit rather than a tab beside it, because it is opened now and then
 * and not every day; the way back is the place's own name.
 */
export function PlaceMembers() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const spaces = useSpaces();
  const space = spaces.data?.items.find(one => one.id === spaceId) ?? null;
  const mayShare = useMayIn(spaceId, 'own');

  if (spaces.isPending) return <Waiting lines={4} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;
  if (!space) return <NoLongerHere what="space" />;

  return (
    <section className={`${styles.page} ${styles.reading}`}>
      <header className={styles.head}>
        <BackLink to={placePath(space.id)} label={t('place.backTo', { name: space.name })} />
        <h1 className={styles.title}>
          {t('place.members.title')}
          <span className={styles.titleNote}>{space.name}</span>
        </h1>
      </header>
      <Members spaceId={space.id} name={space.name} kind={space.kind} roomId={space.roomId} />
      {/* Sharing is two things: letting somebody in, above, and letting somebody look without an account, which is a link. */}
      {mayShare ? (
        <p className={ui.note}>
          {t('place.members.lookOnly')}{' '}
          <Link to="/me/share-links" className={ui.headLink}>
            {t('place.members.shareLink')} ›
          </Link>
        </p>
      ) : null}
    </section>
  );
}
