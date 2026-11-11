import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { useSession } from '@/api/session';
import { isVisiting } from '@/ui/session-access';
import { readStored, writeStored } from '@/ui/stored';

/**
 * Where a place's pages are, and the one place Grow, Verlauf and Steuerung are
 * about.
 *
 * A place has one page of its own, its Start, and the pages it is a tap from -
 * who else is let in. Grow, Verlauf and Steuerung are items of the bar and not
 * pages of a place: they show the place chosen in the header, and a link that
 * names another - an alert, a tile of a place - carries it in the query and
 * so chooses it.
 */

/** A card of the home that stands for a place, rather than for a grow standing in none. */
export type PlaceCard = HomeSpaceCard & { spaceId: string };

export const isPlace = (card: HomeSpaceCard): card is PlaceCard => card.spaceId !== null;

const withQuery = (path: string, query: Record<string, string>): string => `${path}?${new URLSearchParams(query).toString()}`;

export const placePath = (spaceId: string): string => `/spaces/${spaceId}`;

/** Grow, the bar's item: the grow running in the chosen place. */
export const GROW = '/grow';

/** "My grows", every grow of the account, which Grow, Start and Me lead to. */
export const MY_GROWS = '/grows';

/** What a grow page is told when it is opened from "My grows", so its way back leads there. */
export const FROM_MY_GROWS = { from: 'grows' } as const;

/** What "My grows" is told when Ich's door opens it, so its way back leads to Ich rather than to Start. */
export const FROM_ME = { from: 'me' } as const;

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

/** The pages that show the chosen place, and whose address may name it. */
const ABOUT_PLACE = [GROW, '/timeline', '/control', '/charts'];

export const isAboutPlace = (pathname: string): boolean => ABOUT_PLACE.some(path => pathname === path || pathname.startsWith(`${path}/`));

/**
 * The chosen place: a preference of this browser rather than a fact about the
 * account, which is why it is not on the server. It is a store, so the header
 * and the page under it follow a choice together.
 */
const KEY = 'terp.place';

/** What a browser that keeps nothing was told, for as long as the page lives. */
let unkept: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const chosenPlace = (): string | null => readStored(KEY) ?? unkept;

const choosePlace = (spaceId: string) => {
  if (chosenPlace() === spaceId) return;
  writeStored(KEY, spaceId);
  unkept = readStored(KEY) === spaceId ? null : spaceId;
  for (const listener of listeners) listener();
};

const useChosenPlace = (): string | null => useSyncExternalStore(subscribe, chosenPlace, chosenPlace);

/** Looking at a place makes it the one the bar's pages open on. */
export const useChoosePlace = (spaceId: string) => {
  useEffect(() => {
    if (spaceId) choosePlace(spaceId);
  }, [spaceId]);
};

/** The place the pages about one place show: the one the address names, else the chosen one, else the first the home lists. */
const placeShown = (places: PlaceCard[], asked: string | null, chosen: string | null): PlaceCard | null =>
  places.find(place => place.spaceId === asked) ?? places.find(place => place.spaceId === chosen) ?? places[0] ?? null;

/**
 * The place shown among `places`, as `placeShown` picks it, and how another
 * is chosen. A place the address names is chosen by that, so a link from an
 * alert carries Steuerung along with Verlauf.
 *
 * On a page about the place a choice goes into its address and is kept once
 * the address names it: a switch that the page holds back - targets nobody
 * saved - must not move the next page too. It drops whatever else the address
 * said about the place being left.
 *
 * `visiting` is the place the address names where `isVisiting` says it is a
 * customer's, which is drawn as that place rather than swapped for one of ours.
 */
export const usePlaceChoice = (places: PlaceCard[] | undefined) => {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const chosen = useChosenPlace();
  const about = isAboutPlace(pathname);
  const asked = about ? params.get('space') : null;
  const here = placeShown(places ?? [], asked, chosen);
  const named = here !== null && here.spaceId === asked ? asked : null;
  const own = places?.map(place => place.spaceId);
  const visiting = asked && isVisiting(user, asked, own) ? asked : null;

  useEffect(() => {
    if (named) choosePlace(named);
  }, [named]);

  const choose = (spaceId: string) => {
    if (about) void setParams({ space: spaceId }, { replace: true });
    else choosePlace(spaceId);
  };

  return { here, visiting, choose };
};

/** The chosen place for a page about it, with the home it is read from. */
export const useCurrentPlace = () => {
  const home = useHome();
  const places = (home.data?.spaces ?? []).filter(isPlace);

  return { home, places, ...usePlaceChoice(home.data && places) };
};

/**
 * Where the way back from a page below a place leads: that place's Start,
 * which for an account with one place is Start itself. A grow and the task
 * list are opened from a place's blocks, so that is where back returns to;
 * with several places it is the named one - or, where none is named, the
 * chosen one - and Start only where neither is one of the account's.
 */
export const useBackToPlace = (spaceId: string | null = null): { to: string; name: string | null } => {
  const home = useHome();
  const chosen = useChosenPlace();
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const wanted = spaceId ?? chosen;
  const place = places.length > 1 ? (places.find(one => one.spaceId === wanted) ?? null) : null;

  return place ? { to: placePath(place.spaceId), name: place.name } : { to: '/', name: null };
};
