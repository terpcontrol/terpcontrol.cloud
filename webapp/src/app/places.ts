import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { HomeSpaceCard, Placement } from '@fg2/shared-types/v1';
import { useHome, useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { sortedByAttention } from '@/screens/start/attention';
import { isVisiting, standsIn } from '@/ui/session-access';
import { readStored, writeStored } from '@/ui/stored';

/**
 * Where a place's pages are, and the one place Grow, Verlauf and Steuerung are
 * about.
 *
 * A place has one page of its own, its Start, and the pages it is a tap from -
 * who else is let in. Grow, Verlauf and Steuerung are items of the bar and not
 * pages of a place: they show the place chosen in the header, and whatever
 * names another - a link from an alert, a page that belongs to that place -
 * chooses it, so the header never names a place the page is not about.
 */

/** A card of the home that stands for a place, rather than for a grow standing in none. */
export type PlaceCard = HomeSpaceCard & { spaceId: string };

export const isPlace = (card: HomeSpaceCard): card is PlaceCard => card.spaceId !== null;

const withQuery = (path: string, query: Record<string, string>): string => `${path}?${new URLSearchParams(query).toString()}`;

export const placePath = (spaceId: string): string => `/spaces/${spaceId}`;

/** Grow, the bar's item: the grow running in the chosen place. */
export const GROW = '/grow';

/** "Alle Grows", every grow the account sees, which Grow and Ich lead to. */
export const ALL_GROWS = '/grows';

/** The pages behind the doors of "Alle Grows": what belongs to growing without being a grow. */
export const SCHEMES = `${ALL_GROWS}/schemes`;
export const SHARE_LINKS = `${ALL_GROWS}/share-links`;
export const FOLLOWING = `${ALL_GROWS}/following`;

/** What the list of every grow is told when Ich's door opened it, so its way back leads to Ich rather than to Grow. */
export const FROM_ME = { from: 'me' } as const;

/** Whether a page was opened from where `from` says, by the state the link that opened it carried. */
export const openedFrom = (state: unknown, from: { from: string }): boolean => (state as { from?: unknown } | null)?.from === from.from;

/**
 * What a page under a grow - its measurements, one of its plants - is told by
 * the link that opened it: the address it leads back to. A grow is on screen
 * under two, the bar's own and its id, and the way back is the one taken.
 */
export const leadingBackTo = (pathname: string) => ({ back: pathname });

export const backOf = (state: unknown, otherwise: string): string => {
  const back = (state as { back?: unknown } | null)?.back;
  return typeof back === 'string' ? back : otherwise;
};

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

/**
 * The Timeline of a place, opened on one reading where `focus` names it, and
 * on one moment where `at` does. A moment of a grow's diary names the grow as
 * well: further back than the rolling windows reach, it is the grow's own
 * stretch that holds it.
 */
export const timelinePath = (spaceId: string, focus: string | null = null, at: string | null = null, growId: string | null = null): string =>
  withQuery('/timeline', { space: spaceId, ...(focus ? { focus } : {}), ...(at ? { at } : {}), ...(growId ? { grow: growId } : {}) });

/** Graphen of a place, with the curves named drawn and no others: the way from a reading Verlauf has no panel for. */
export const chartsPath = (spaceId: string, show: string | null = null): string =>
  withQuery('/charts', { space: spaceId, ...(show ? { show } : {}) });

/** The account's devices, with the ones standing in a place opened where it is named. */
export const devicesPath = (spaceId: string | null = null): string => (spaceId ? withQuery('/devices', { space: spaceId }) : '/devices');

/**
 * The addresses of the bar's items that show the chosen place: each with the
 * pages under it, and with the place in `?space=` where a link names one.
 * Graphen stands under Verlauf for as long as it is a page of its own, and is
 * about a grow instead where its address names one.
 */
const ITEMS = [GROW, '/timeline', '/control', '/charts'];

const itemOf = (pathname: string, search: string): string | null => {
  const item = ITEMS.find(path => pathname === path || pathname.startsWith(`${path}/`)) ?? null;
  return item === '/charts' && new URLSearchParams(search).has('grow') ? null : item;
};

/** Whether an address is one of those: a page that shows the chosen place. */
export const isAboutPlace = (pathname: string, search = ''): boolean => itemOf(pathname, search) !== null;

/**
 * The chosen place, and the place the page on screen belongs to where it is
 * not one of those items. The choice is a preference of this browser rather
 * than a fact about the account, which is why it is not on the server. Both
 * are a store, so the header and the page under it follow together.
 */
const KEY = 'terp.place';

/** What a browser that keeps nothing was told, for as long as the page lives. */
let unkept: string | null = null;
let pageOf: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const told = () => {
  for (const listener of listeners) listener();
};

const chosenPlace = (): string | null => readStored(KEY) ?? unkept;

const choosePlace = (spaceId: string) => {
  if (chosenPlace() === spaceId) return;
  writeStored(KEY, spaceId);
  unkept = readStored(KEY) === spaceId ? null : spaceId;
  told();
};

const useChosenPlace = (): string | null => useSyncExternalStore(subscribe, chosenPlace, chosenPlace);

const pagePlace = (): string | null => pageOf;

/**
 * A page that belongs to one of the account's places says so: the place's
 * Start, who is let into it, a grow running there, its camera, its devices.
 * Opening it makes that place the chosen one, and while it is on screen the
 * header's choice of another leads to that one's Start - the page has nothing
 * to say about a place it does not belong to.
 *
 * A place that is none of the account's - a customer's, read by support - is
 * no choice of the reader's and is left out.
 */
export const usePageOfPlace = (spaceId: string | null) => {
  const { user } = useSession();
  const home = useHomeShape(user !== null);
  const own = spaceId !== null && (home.data?.spaces ?? []).some(card => card.spaceId === spaceId) ? spaceId : null;

  useEffect(() => {
    if (!own) return;
    choosePlace(own);
    pageOf = own;
    told();
    return () => {
      pageOf = null;
      told();
    };
  }, [own]);
};

/** A page of a grow belongs to the place the grow is running in; a finished grow, and one standing in no place, to none. */
export const usePageOfGrow = (grow: { endedAt: string | null; placements: Placement[] } | undefined) =>
  usePageOfPlace(grow && grow.endedAt === null ? standsIn(grow) : null);

/**
 * The place a browser that has chosen none is shown, the same for Grow,
 * Verlauf and Steuerung: in Start's order - the place that needs a person
 * first - the first where a grow runs, else the first with a device, else the
 * first. So Grow does not open on an empty balcony while a tent is in flower.
 */
const firstChoice = (places: PlaceCard[]): PlaceCard | null => {
  const ordered = sortedByAttention(places);
  return ordered.find(place => place.grow !== null) ?? ordered.find(place => (place.deviceIds ?? []).length > 0) ?? ordered[0] ?? null;
};

/** The place the pages about one place show: the one the address names, else the chosen one, else the first choice. */
const placeShown = (places: PlaceCard[], asked: string | null, chosen: string | null): PlaceCard | null =>
  places.find(place => place.spaceId === asked) ?? places.find(place => place.spaceId === chosen) ?? firstChoice(places);

/**
 * The place shown among `places`, as `placeShown` picks it, and how another
 * is chosen. Whatever it picks is kept: a place the address names, so a link
 * from an alert carries Steuerung along with Verlauf, and the first pick of a
 * browser that had none, so it does not move when another place starts
 * needing a person.
 *
 * Choosing depends on the page. On one of the bar's three the item stays, at
 * its own address for the place chosen, and the choice is kept once that
 * address is on screen: a switch that the page holds back - targets nobody
 * saved - must not move the next page too. On a grow opened by its id it
 * leads to Grow of the chosen place, on any other page that belongs to a
 * place to that place's Start; anywhere else it only changes the choice.
 *
 * `visiting` is the place the address names where `isVisiting` says it is a
 * customer's, which is drawn as that place rather than swapped for one of
 * ours. `stray` is an address naming a place the account has not got, which
 * the page that reads it takes out again.
 */
export const usePlaceChoice = (places: PlaceCard[] | undefined) => {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const chosen = useChosenPlace();
  const belongs = useSyncExternalStore(subscribe, pagePlace, pagePlace) !== null;
  const item = itemOf(pathname, search);
  const asked = item ? params.get('space') : null;
  const here = placeShown(places ?? [], asked, chosen);
  const own = places?.map(place => place.spaceId);
  const visiting = asked && isVisiting(user, asked, own) ? asked : null;
  const stray = asked !== null && own !== undefined && !own.includes(asked) && !visiting;
  const kept = here && here.spaceId !== chosen ? here.spaceId : null;

  useEffect(() => {
    // Not over a choice made since this was drawn: the page opened with it may belong to a place and have said so first.
    if (kept && (kept === asked || chosenPlace() === chosen)) choosePlace(kept);
  }, [kept, asked, chosen]);

  const choose = (spaceId: string) => {
    const of = (path: string) => `${path}?${new URLSearchParams({ space: spaceId }).toString()}`;
    if (item) void navigate(of(item), { replace: true });
    else if (belongs) void navigate(pathname.startsWith(`${ALL_GROWS}/`) ? of(GROW) : placePath(spaceId));
    else choosePlace(spaceId);
  };

  return { here, visiting, stray, choose };
};

/** The chosen place for a page about it, with the home it is read from. */
export const useCurrentPlace = () => {
  const home = useHome();
  const [, setParams] = useSearchParams();
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const choice = usePlaceChoice(home.data && places);
  // Not while the home is being read again: a place made a moment ago is named by a link before the home lists it.
  const stray = choice.stray && !home.isFetching;

  useEffect(() => {
    if (stray) void setParams({}, { replace: true });
  }, [stray, setParams]);

  return { home, places, ...choice };
};
