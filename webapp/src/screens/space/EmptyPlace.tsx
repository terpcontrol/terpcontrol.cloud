import { useTranslation } from 'react-i18next';
import { useSpaceOverview, useSpaces } from '@/api/spaces';
import { removePath } from '@/app/places';
import { Row } from '@/ui/Rows';
import { enough } from '@/ui/session-access';

/**
 * A place with nothing left in it - no device, no camera, no grow - said to
 * its owner on its Start, in a row that leads to ending it: devices moved
 * together leave their old places empty, and an empty place stays a card of
 * its own until somebody ends it. Nothing removes it on its own, because an
 * empty tent between two grows is a place somebody still means to use.
 *
 * Only where the account has another place: the last one is Start itself.
 */
export function EmptyPlace({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId).data;
  const spaces = useSpaces().data?.items ?? [];
  const space = spaces.find(one => one.id === spaceId);
  const others = spaces.some(one => one.id !== spaceId && one.kind !== 'room' && one.archivedAt === null && one.ownerId === space?.ownerId);
  const empty = overview?.deviceIds?.length === 0 && overview.cameras.length === 0 && overview.grows.length === 0;

  if (!overview || !space || !empty || !others || !enough(space.youMay, 'own')) return null;

  return (
    <div role="status">
      <Row alone to={removePath(spaceId)} title={t('space.empty.says')} line={t('space.empty.remove', { name: overview.name })} />
    </div>
  );
}
