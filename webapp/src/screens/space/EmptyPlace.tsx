import { useTranslation } from 'react-i18next';
import { useRemoveSpace, useSpaceOverview, useSpaces } from '@/api/spaces';
import { Refused } from '@/ui/PageState';
import { enough } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import styles from './EmptyPlace.module.css';

/**
 * A place with nothing left in it - no device, no camera, no grow - offered
 * for removal to its owner, who decides: devices moved together leave their old
 * places empty, and an empty place stays a card of its own on Start until
 * somebody ends it. Nothing removes it on its own, because an empty tent
 * between two grows is a place somebody still means to use.
 *
 * Only where the account has another place: the last one is Start itself.
 */
export function EmptyPlace({ spaceId, onRemoved }: { spaceId: string; onRemoved?: () => void }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId).data;
  const spaces = useSpaces().data?.items ?? [];
  const remove = useRemoveSpace(spaceId);
  const space = spaces.find(one => one.id === spaceId);
  const others = spaces.some(one => one.id !== spaceId && one.kind !== 'room' && one.archivedAt === null);
  const empty = overview?.deviceIds?.length === 0 && overview.cameras.length === 0 && overview.grows.length === 0;

  if (!overview || !space || !empty || !others || !enough(space.youMay, 'own')) return null;

  return (
    <div className={`${ui.note} ${styles.empty}`} role="status">
      <p>{t('space.empty.says', { name: overview.name })}</p>
      <button type="button" className={ui.button} disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: onRemoved })}>
        {remove.isPending ? t('space.empty.removing') : t('space.empty.remove', { name: overview.name })}
      </button>
      <p>{t('space.empty.note')}</p>
      <Refused error={remove.error} />
    </div>
  );
}
