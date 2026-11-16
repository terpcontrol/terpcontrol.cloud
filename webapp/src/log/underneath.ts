import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { GROW, growShown, isAboutPlace, isPlace, usePlaceChoice } from '@/app/places';
import { useGrows } from '@/api/grows';
import { useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { useLastAim, type LogOpening } from './log-context';
import { placeAim, targetsOf } from './targets';

/**
 * What the page underneath the Eintrag button is about. A page about one grow
 * aims at that grow: a grow page or one of its plants, Grow - the bar's item -
 * and its tabs, which show the grow `shown` names, and Verlauf narrowed to a grow
 * (`grow=`). A page about a place aims at the place: its own page and the chosen
 * place on the pages that show it, and on Start the place Start is, where it is
 * one. A page about neither answers nothing. Where two grows stand in one place,
 * a page about the place opens on the one it leads with (`placeAim`).
 *
 * The rail and the tab bar sit outside the routes, so they read the address
 * rather than the route's parameters. Without this the button opened on the
 * chip chosen last time, so a Water tapped on Tent 1's page was written into a
 * grow standing in another place.
 *
 * `current` is the chosen place, which a page about it shows when its address
 * names none, `shown` the grow Grow shows in it (`growShown`), and `only` the
 * place of an account that has exactly one. A grow
 * named alongside its place is still the place's where the sheet has no chip of
 * it - a grow of Verlauf's that has ended.
 */
export const openingOf = (
  pathname: string,
  search = '',
  { current = null, only = null, shown = null }: { current?: string | null; only?: string | null; shown?: string | null } = {},
): LogOpening => {
  const [first, id] = pathname.split('/').filter(Boolean);
  if (first === 'grows' && id) return { growId: id, underneath: true };
  if (first === 'spaces' && id) return { spaceId: id, underneath: true };

  const params = new URLSearchParams(search);
  const place = isAboutPlace(pathname) ? (params.get('space') ?? current) : first === undefined ? only : null;
  // Grow of a place the address names that is not the chosen one - a customer's, read by support - shows that place's.
  const grow = `/${first}` === GROW ? (place === current ? shown : null) : first === 'timeline' ? params.get('grow') : null;
  return { ...(grow ? { growId: grow } : {}), ...(place ? { spaceId: place } : {}), ...(grow || place ? { underneath: true } : {}) };
};

export const useOpeningUnderneath = (): LogOpening => {
  const { pathname, search } = useLocation();
  const { user } = useSession();
  const home = useHomeShape(user !== null);
  const places = home.data?.spaces.filter(isPlace);
  const only = places?.length === 1 ? places[0].spaceId : null;
  const here = usePlaceChoice(places).here;
  const current = here?.spaceId ?? null;
  const lead = usePlaceGrow(current);
  // Until the grows are read the place's own rule aims the sheet, rather than the newer that Grow falls back on.
  const shown = home.data && lead !== undefined ? growShown(home.data.spaces, here, lead) : null;

  return useMemo(() => openingOf(pathname, search, { current, only, shown }), [pathname, search, current, only, shown]);
};

/**
 * The grow a page about a place leads with where two grow there - Start's picture and first card, Grow, Verlauf's
 * days - by the rule Eintrag opened over that page aims by (`placeAim`). Undefined until the home and the grows are
 * read, null where nothing grows in the place.
 */
export const usePlaceGrow = (spaceId: string | null): string | null | undefined => {
  const { user } = useSession();
  const home = useHomeShape(user !== null);
  const grows = useGrows(user !== null);
  const last = useLastAim();

  return useMemo(
    () =>
      !home.data || grows.isPending
        ? undefined
        : (placeAim(targetsOf(home.data, grows.data?.items), spaceId, last, grows.data?.items)?.growId ?? null),
    [home.data, grows.isPending, grows.data, spaceId, last],
  );
};
