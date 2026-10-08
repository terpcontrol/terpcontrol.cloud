import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { useSession } from '@/api/session';
import { isVisiting } from '@/ui/session-access';
import { readStored, writeStored } from '@/ui/stored';

/**
 * Where a place's pages are, and which place the tabs that are about one place
 * open on.
 *
 * A place has one page of its own, its cockpit, and the pages it is a tap from
 * - who else is let in. Verlauf and Steuerung are tabs of the bar and not pages
 * of a place, so they carry the place they are about in the query rather than
 * in the path: a link from an alert names it, and the tab opened on its own
 * lands on the place last looked at.
 */

/** A card of the home that stands for a place, rather than for a grow standing in none. */
export type PlaceCard = HomeSpaceCard & { spaceId: string };

export const isPlace = (card: HomeSpaceCard): card is PlaceCard => card.spaceId !== null;

const withQuery = (path: string, query: Record<string, string>): string => `${path}?${new URLSearchParams(query).toString()}`;

export const placePath = (spaceId: string): string => `/spaces/${spaceId}`;

/** "My grows", every grow of the account, which Start and Me lead to. */
export const MY_GROWS = '/grows';

/** What a grow page is told when it is opened from "My grows", so its way back leads there. */
export const FROM_MY_GROWS = { from: 'grows' } as const;

/** What "My grows" is told when Ich's door opens it, so its way back leads to Ich rather than to Start. */
export const FROM_ME = { from: 'me' } as const;

/** What a camera's page is told when a place's picture opens it, so the bar keeps Start marked rather than jumping to Gerät. */
export const FROM_PLACE = { from: 'place' } as const;

/** Whether a page was opened from where `from` says, by the state the link that opened it carried. */
export const openedFrom = (state: unknown, from: { from: string }): boolean => (state as { from?: unknown } | null)?.from === from.from;

export const membersPath = (spaceId: string): string => `/spaces/${spaceId}/members`;

/** The pages below Steuerung: the targets it opens on where a plan runs, the alarm rules, and the plan where none does. */
export const CONTROL_PAGES = ['targets', 'alarms', 'plan'] as const;
export type ControlPage = (typeof CONTROL_PAGES)[number];

export const controlPath = (
  spaceId: string,
  page: ControlPage | null = null,
  query: Record<string, string> = {},
  hash: string | null = null,
): string => withQuery(page ? `/control/${page}` : '/control', { space: spaceId, ...query }) + (hash ? `#${hash}` : '');

/** The Timeline of a place, opened on one reading where `focus` names it, and on one moment where `at` does. */
export const timelinePath = (spaceId: string, focus: string | null = null, at: string | null = null): string =>
  withQuery('/timeline', { space: spaceId, ...(focus ? { focus } : {}), ...(at ? { at } : {}) });

/** The account's devices, with the ones standing in a place opened where it is named. */
export const devicesPath = (spaceId: string | null = null): string => (spaceId ? withQuery('/devices', { space: spaceId }) : '/devices');

/**
 * Which place Verlauf and Steuerung open on: a preference of this browser
 * rather than a fact about the account, which is why it is not on the server.
 */
const KEY = 'terp.place';

const lastPlace = (): string | null => readStored(KEY);

const rememberPlace = (spaceId: string) => writeStored(KEY, spaceId);

/** Looking at a place makes it the one the tabs open on next. */
export const useRememberPlace = (spaceId: string) => {
  useEffect(() => {
    if (spaceId) rememberPlace(spaceId);
  }, [spaceId]);
};

/**
 * Where the way back from a page below a place leads: that place's cockpit,
 * which for an account with one place is Start itself. A grow and the task
 * list are opened from a cockpit's grow block, so that is where back returns
 * to; with several places it is the named one - or, where none is named, the
 * one last looked at - and Start only where neither is one of the account's.
 */
export const useBackToPlace = (spaceId: string | null = null): { to: string; name: string | null } => {
  const home = useHome();
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const wanted = spaceId ?? lastPlace();
  const place = places.length > 1 ? (places.find(one => one.spaceId === wanted) ?? null) : null;

  return place ? { to: placePath(place.spaceId), name: place.name } : { to: '/', name: null };
};

/**
 * The place a tab about one place is showing: the one its address names, else
 * the one last looked at, else the first the home lists - which is the only one
 * for most accounts.
 */
export const placeShown = (places: PlaceCard[], asked: string | null): PlaceCard | null => {
  const remembered = lastPlace();
  return places.find(place => place.spaceId === asked) ?? places.find(place => place.spaceId === remembered) ?? places[0] ?? null;
};

/**
 * The place a tab about one place is showing, as `placeShown` chooses it. A
 * place the address names is remembered, so a link from an alert carries
 * Steuerung along with Verlauf. Choosing another one puts it in the address,
 * and drops whatever else the address said about the place being left.
 *
 * `visiting` is the place the address names where `isVisiting` says it is a
 * customer's, which is drawn as that place rather than swapped for one of ours.
 */
export const useCurrentPlace = () => {
  const home = useHome();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const asked = params.get('space');
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const here = placeShown(places, asked);
  const named = here !== null && here.spaceId === asked ? here.spaceId : null;
  const visiting = asked && isVisiting(user, asked, home.data && places.map(place => place.spaceId)) ? asked : null;

  useEffect(() => {
    if (named) rememberPlace(named);
  }, [named]);

  // Remembered once the address names it, by the effect above: a switch that
  // a page holds back - targets nobody saved - must not move the next tab too.
  const choose = (spaceId: string) => setParams({ space: spaceId }, { replace: true });

  return { home, places, here, visiting, choose };
};
