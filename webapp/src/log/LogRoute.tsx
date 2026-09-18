import { useLayoutEffect, useRef } from 'react';
import { useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { useLog, useMayLog, type TileKind } from './log-context';

/**
 * `/log` as a link, for everything that cannot call the sheet directly: a
 * notification, a bookmark, a screen that hands the sheet a tile to open.
 *
 * The sheet is not a screen - it belongs over the one you were on - so this
 * route opens it and immediately gives the address back, either to where the
 * link was followed from or, when there is no such place, to the home.
 */

const TILES: TileKind[] = ['water', 'feed', 'photo', 'note', 'measurement', 'training', 'phase', 'visit'];

export function LogRoute() {
  const { openSheet } = useLog();
  const mayLog = useMayLog();
  const navigate = useNavigate();
  const arrival = useNavigationType();
  const [search] = useSearchParams();
  const opened = useRef(false);

  useLayoutEffect(() => {
    if (opened.current) return;
    opened.current = true;

    // The address is as open as any other; what may be written through it is not.
    const kind = TILES.find(tile => tile === search.get('kind')) ?? null;
    if (mayLog) openSheet({ growId: search.get('grow'), spaceId: search.get('space'), kind });

    // Followed from inside the app, the screen behind is one step back; opened
    // cold, there is nothing behind it and the home is where a sheet belongs.
    void (arrival === 'PUSH' ? navigate(-1) : navigate('/', { replace: true }));
  }, [arrival, mayLog, navigate, openSheet, search]);

  return null;
}
