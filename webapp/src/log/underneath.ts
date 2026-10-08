import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { isPlace, placeShown } from '@/app/places';
import { useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import type { LogOpening } from './log-context';

/**
 * The place the page underneath the Log button is about: the grow of a grow
 * page or of one of its plants, the place of a cockpit, and the place Verlauf
 * or Steuerung is showing; on Start, the place Start is, where it is one. A
 * page about neither answers nothing.
 *
 * The rail and the tab bar sit outside the routes, so they read the address
 * rather than the route's parameters. Without this the button opened on the
 * chip chosen last time, so a Water tapped on Tent 1's page was written into a
 * grow standing in another place.
 *
 * `current` is the place a tab about one place shows when its address names
 * none, and `only` the place of an account that has exactly one.
 */
export const openingOf = (
  pathname: string,
  search = '',
  { current = null, only = null }: { current?: string | null; only?: string | null } = {},
): LogOpening => {
  const [first, id] = pathname.split('/').filter(Boolean);
  if (first === 'grows' && id) return { growId: id, underneath: true };
  if (first === 'spaces' && id) return { spaceId: id, underneath: true };

  const place =
    first === 'timeline' || first === 'control' ? (new URLSearchParams(search).get('space') ?? current) : first === undefined ? only : null;
  return place ? { spaceId: place, underneath: true } : {};
};

export const useOpeningUnderneath = (): LogOpening => {
  const { pathname, search } = useLocation();
  const { user } = useSession();
  const home = useHomeShape(user !== null);
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const only = places.length === 1 ? places[0].spaceId : null;
  const current = placeShown(places, null)?.spaceId ?? null;

  return useMemo(() => openingOf(pathname, search, { current, only }), [pathname, search, current, only]);
};
