import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { HomeSpaceCard, Placement, Space } from '@fg2/shared-types/v1';
import { useHome, useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { startOrder } from '@/screens/start/rooms';
import { isVisiting, standsIn } from '@/ui/session-access';
import { readStored, writeStored } from '@/ui/stored';

/**
 * Where a place's pages are, and the one place Grow, Verlauf and Steuerung are
 * about. Those three are items of the bar and not pages of a place: they show
 * the place chosen in the header, and whatever names another - a link from an
 * alert, a page that belongs to that place - chooses it, so the header never
 * names a place the page is not about.
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

/**
 * What a socket's page is told by the row under Ausgänge that opened it: the address it puts in its own place once
 * the socket is removed. The head's arrow needs none - it steps back in history (`ui/BackLink.tsx`).
 */
export const leadingBackTo = (pathname: string) => ({ back: pathname });

export const backOf = (state: unknown, otherwise: string): string => {
  const back = (state as { back?: unknown } | null)?.back;
  return typeof back === 'string' ? back : otherwise;
};

export const membersPath = (spaceId: string): string => `/spaces/${spaceId}/members`;

/** "Ort bearbeiten", which the ⋯ beside a place's name opens, and the page under it that ends the place. */
export const editPath = (spaceId: string): string => `${placePath(spaceId)}/edit`;
export const removePath = (spaceId: string): string => `${placePath(spaceId)}/remove`;

/** The pages below Steuerung, each behind a row under the climate: the alarm rules, the grow plan, the outputs, the work mode. */
export const CONTROL_PAGES = ['alarms', 'plan', 'outputs', 'mode'] as const;
export type ControlPage = (typeof CONTROL_PAGES)[number];

export const controlPath = (
  spaceId: string,
  page: ControlPage | null = null,
  query: Record<string, string> = {},
  hash: string | null = null,
): string => withQuery(page ? `/control/${page}` : '/control', { space: spaceId, ...query }) + (hash ? `#${hash}` : '');

/**
 * Verlauf of a place, opened on one reading where `focus` names it and with
 * its cursor on one moment where `at` does - however old, with that moment's
 * own day around it. A moment of a grow's diary names the grow as well, whose
 * bands and day count are then the ones drawn. What the address means is read
 * in `screens/timeline/view.ts`.
 */
export const timelinePath = (
  spaceId: string,
  focus: string | null = null,
  at: string | null = null,
  growId: string | null = null,
  /** A window named outright, as two instants: one day of a grow, the stretch of an old bookmark. */
  window: { from: string; to: string } | null = null,
  /** The device whose curves are meant, where the place may hold a second climate: an alert's. */
  deviceId: string | null = null,
): string =>
  withQuery('/timeline', {
    space: spaceId,
    ...(deviceId ? { device: deviceId } : {}),
    ...(focus ? { focus } : {}),
    ...(at ? { at } : {}),
    ...(growId ? { grow: growId } : {}),
    ...(window ?? {}),
  });

/** The pages below a device's own: what few growers set, and what support asks for. */
export const DEVICE_PAGES = ['advanced', 'details'] as const;
export type DevicePageName = (typeof DEVICE_PAGES)[number];

/** A device's own page, reached from its card under Steuerung. */
export const devicePath = (deviceId: string, page: DevicePageName | null = null): string =>
  `/devices/${encodeURIComponent(deviceId)}${page ? `/${page}` : ''}`;

/** One smart socket of a device, by the key its row is known by (`rowsOf`, `screens/devices/sockets.ts`). */
export const socketPath = (deviceId: string, socket: string): string => `${devicePath(deviceId)}/sockets/${encodeURIComponent(socket)}`;

export const cameraPath = (cameraId: string): string => `/cameras/${encodeURIComponent(cameraId)}`;

/**
 * The addresses of the bar's items that show the chosen place: each with the
 * pages under it, and with the place in `?space=` where a link names one.
 * Graphen stands under Verlauf for as long as it is a page of its own, and is
 * about a grow instead where its address names one.
 */
const ITEMS = [GROW, '/timeline', '/control'];

const itemOf = (pathname: string): string | null => ITEMS.find(path => pathname === path || pathname.startsWith(`${path}/`)) ?? null;

/** Whether an address is one of those: a page that shows the chosen place. */
export const isAboutPlace = (pathname: string): boolean => itemOf(pathname) !== null;

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
 * header's choice of another leads to that one's Start. A place that is none
 * of the account's - a customer's, read by support - is left out.
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
 * Verlauf and Steuerung: in the order Start lists the places (`startOrder`)
 * the first where a grow runs, else the first with a device, else the first -
 * so Grow does not open on an empty balcony while a tent is in flower.
 */
export const firstChoice = (places: PlaceCard[], spaces: readonly Space[]): PlaceCard | null => {
  const ordered = startOrder(places, spaces).flatMap(group => group.cards);
  return ordered.find(place => place.grow !== null) ?? ordered.find(place => (place.deviceIds ?? []).length > 0) ?? ordered[0] ?? null;
};

/**
 * The place the pages about one place show: the one the address names, else
 * the chosen one, else the first choice - which waits for the rooms the order
 * is made with (`spaces`) rather than choosing by half of it.
 */
const placeShown = (places: PlaceCard[], asked: string | null, chosen: string | null, spaces: readonly Space[] | undefined): PlaceCard | null =>
  places.find(place => place.spaceId === asked) ?? places.find(place => place.spaceId === chosen) ?? (spaces ? firstChoice(places, spaces) : null);

/**
 * The place shown among `places`, as `placeShown` picks it, and how another
 * is chosen. Whatever it picks is kept: a place the address names, so a link
 * from an alert carries Steuerung along with Verlauf, and the first pick of a
 * browser that had none, so it does not move when another place starts
 * needing a person.
 *
 * Choosing depends on the page. On one of the bar's three the item stays, at
 * its own address for the place chosen - a page below Steuerung at that page,
 * since the other place has its alarms and its outputs too - and the choice
 * is kept once that address is on screen: a switch that the page holds back
 * must not move the next page too. On a grow opened by its id it
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
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const chosen = useChosenPlace();
  const belongs = useSyncExternalStore(subscribe, pagePlace, pagePlace) !== null;
  const item = itemOf(pathname);
  const asked = item ? params.get('space') : null;
  const spaces = useSpaces(user !== null);
  // Rooms that could not be read group nothing; the places are still there to choose from.
  const here = placeShown(places ?? [], asked, chosen, spaces.data?.items ?? (spaces.isError ? [] : undefined));
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
    if (item) void navigate(of(item === '/control' ? pathname : item), { replace: true });
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
