import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { editPath, placePath, usePageOfPlace } from '@/app/places';
import { useSpaces } from '@/api/spaces';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import { Members } from '../space/members/Members';
import styles from './Place.module.css';

/**
 * Who else is let into a place, for a member who may not manage it: reached
 * from the line on its Start that says whose place it is, and where they
 * leave. Whoever manages the place has the same list on "Ort bearbeiten".
 */
export function PlaceMembers() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const spaces = useSpaces();
  const space = spaces.data?.items.find(one => one.id === spaceId) ?? null;
  const mayManage = useMayManage(spaceId);
  usePageOfPlace(spaceId || null);

  if (spaces.isPending) return <Waiting lines={4} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;
  // A room has no page: who is in it is chosen on a place standing in it.
  if (!space || space.kind === 'room') return <NoLongerHere what="space" />;
  if (mayManage) return <Navigate to={editPath(space.id)} replace />;

  return (
    <section className={`${styles.page} ${styles.reading}`}>
      <PageHead
        back={{ to: placePath(space.id), label: t('place.backTo', { name: space.name }) }}
        title={t('place.edit.people', { name: space.name })}
      />
      <Members spaceId={space.id} name={space.name} kind={space.kind} roomId={space.roomId} />
    </section>
  );
}
