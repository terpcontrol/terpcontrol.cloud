import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import type { Space } from '@fg2/shared-types/v1';
import { useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { isAboutPlace, loseSight, useChosenPlace, usePagePlace, walkedOutOf } from '@/app/places';
import { useLog } from '@/log/log-context';
import { inSentence } from '@/screens/space/members/people';

/**
 * A place of somebody else's that went while the app was open - its owner ended it, or took the reader out: the
 * places no longer name it, or the home, read on a beat, has stopped listing it. That is said once, in a toast,
 * everything is read again - the bell, the tasks and the bar counted what stood there - and Start does not greet
 * the account as new. A page that was about the place leads to Start, where the toast is said: left standing, it
 * turned into the next place's page or into the empty account's Steuerung. Whoever leaves a place is told where
 * they do it (`walkOut`).
 */
export function LostSight() {
  const { t, i18n } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userId = useSession().user?.id ?? null;
  const home = useHomeShape(userId !== null);
  const spaces = useSpaces(userId !== null);
  const seen = useRef<Space[]>([]);
  const about = useAboutHere();

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
    if (pathname !== '/' && gone.some(one => about.current.ids.has(one.id))) void navigate('/', { replace: true });
  }, [userId, home.data, home.dataUpdatedAt, spaces.data, spaces.dataUpdatedAt, client, tell, t, i18n.language, pathname, navigate, about]);

  return null;
}

/**
 * Every place the page on screen has been about since it was opened: the place its address names, the chosen
 * one on Grow, Verlauf and Steuerung, the one a page of a device, a camera or a grow says it belongs to. Kept
 * for the page's whole stay, because the moment a place goes, each of those turns to another place or to none.
 */
const useAboutHere = () => {
  const { key, pathname, search } = useLocation();
  const chosen = useChosenPlace();
  const page = usePagePlace();
  const about = useRef({ key, ids: new Set<string>() });
  const named = /^\/spaces\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const shown = isAboutPlace(pathname) ? (new URLSearchParams(search).get('space') ?? chosen) : null;

  // Before the effect that reads it, which comes later in the component.
  useEffect(() => {
    if (about.current.key !== key) about.current = { key, ids: new Set() };
    for (const id of [named, shown, page]) if (id) about.current.ids.add(id);
  });

  return about;
};
