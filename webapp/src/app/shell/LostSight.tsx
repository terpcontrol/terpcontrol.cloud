import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Space } from '@fg2/shared-types/v1';
import { useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { loseSight, walkedOutOf } from '@/app/places';
import { useLog } from '@/log/log-context';
import { inSentence } from '@/screens/space/members/people';

/**
 * A place of somebody else's that went while the app was open - its owner ended it, or took the reader out: the
 * places no longer name it, or the home, read on a beat, has stopped listing it. That is said once, in a toast,
 * everything is read again - the bell, the tasks and the bar counted what stood there - and Start does not greet
 * the account as new. Whoever leaves a place is told where they do it (`walkOut`).
 */
export function LostSight() {
  const { t, i18n } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const userId = useSession().user?.id ?? null;
  const home = useHomeShape(userId !== null);
  const spaces = useSpaces(userId !== null);
  const seen = useRef<Space[]>([]);

  useEffect(() => {
    if (!userId || !home.data || !spaces.data) return;
    // What the reader sees: the places as they are named, less what a newer home no longer lists.
    const cards = home.dataUpdatedAt > spaces.dataUpdatedAt ? home.data.spaces : null;
    const places = spaces.data.items.filter(one => one.kind !== 'room' && (cards?.some(card => card.spaceId === one.id) ?? true));
    const others = places.filter(one => one.ownerId !== userId);
    const gone = seen.current.filter(one => !others.some(still => still.id === one.id) && !walkedOutOf(one));
    seen.current = others;
    // Left with nothing, until a place is seen again.
    if (places.length > 0) loseSight(null);
    else if (gone.length > 0) loseSight(userId);
    if (gone.length === 0) return;
    const names = gone.map(one => one.name);
    tell({ label: t('shell.lostSight', { places: inSentence(names, i18n.language) }), undo: null });
    void client.invalidateQueries();
  }, [userId, home.data, home.dataUpdatedAt, spaces.data, spaces.dataUpdatedAt, client, tell, t, i18n.language]);

  return null;
}
