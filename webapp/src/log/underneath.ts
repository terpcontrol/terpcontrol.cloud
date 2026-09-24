import { useMemo } from 'react';
import { useLocation } from 'react-router';
import type { LogOpening } from './log-context';

/**
 * The place the page underneath the Log button is about: the grow of a grow
 * page or of one of its plants, the space of a space page, and nothing on a
 * page that is about neither.
 *
 * The rail and the tab bar sit outside the routes, so they read the address
 * rather than the route's parameters. Without this the button opened on the
 * chip chosen last time, so a Water tapped on Tent 1's page was written into a
 * grow standing in another place.
 */
export const openingOf = (pathname: string): LogOpening => {
  const [first, id] = pathname.split('/').filter(Boolean);
  if (!id) return {};
  if (first === 'grows') return { growId: id, underneath: true };
  if (first === 'spaces') return { spaceId: id, underneath: true };

  return {};
};

export const useOpeningUnderneath = (): LogOpening => {
  const { pathname } = useLocation();
  return useMemo(() => openingOf(pathname), [pathname]);
};
