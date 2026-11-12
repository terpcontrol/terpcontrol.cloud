import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, GrowListItem, HomeAnswer, HomeSpaceCard, LayoutSeen, Me, SpaceOverview, SpaceTimeline } from '@fg2/shared-types/v1';
import { screens } from '@/app/routes';
import { AppShell } from '@/app/shell/AppShell';
import { tabsOf } from '@/app/shell/tabs';
import { openingOf } from '@/log/underneath';
import { json, testClient } from './harness';
import { spacePage, spaceWhere } from './session';
import { translate } from './translations';

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

// A chart is a canvas, which jsdom has not got; Verlauf is opened here for its title.
vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

/**
 * The navigation around the pages, drawn through the real table of addresses
 * under the real shell and answered over the wire: the bar's items by what the
 * account has and the session may do, which of them is marked on which
 * address, one place page with no tabs of its own, one choice of place in the
 * header that Grow, Verlauf and Steuerung all show, and a change to the shape
 * of the app said once.
 */

const ago = (minutes: number) => DateTime.now().minus({ minutes }).toUTC().toISO()!;

const device = (id: string, spaceId: string, type: Device['type'] = 'fridge'): Device =>
  ({
    id,
    type,
    name: type,
    ownerId: server.youMay === 'own' ? 'user-1' : 'user-2',
    spaceId,
    firmware: { channel: 'manual', targetId: null },
    configuration: {
      daynight: { day: 6 * 3600, night: 18 * 3600 },
      day: { temperature: 25, humidity: 60 },
      night: { temperature: 21, humidity: 55 },
      lights: { limit: 100 },
    },
    settings: {},
    state: { lastSeenAt: ago(0.2), hardware: {}, maintenanceUntil: null },
  }) as unknown as Device;

const card = (spaceId: string, name: string): HomeSpaceCard => ({
  spaceId,
  name,
  climates: [],
  kind: spaceId === 'space-1' ? 'fridge' : 'tent',
  roomId: server.room && spaceId !== 'space-3' ? 'room-1' : null,
  deviceIds: [`device-${spaceId.slice(-1)}`],
  values: [
    { metric: 'temperature', value: 25.1, measuredAt: ago(0.3), state: 'live' },
    { metric: 'humidity', value: 61, measuredAt: ago(0.3), state: 'live' },
  ],
  setpoints: server.targets ? [{ metric: 'temperature', value: 25, band: 1 }] : [],
  trend: null,
  grow: server.growing && spaceId === 'space-1' ? GROWING : null,
  entries: [],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
});

/** The grow standing in the first place, as its card names it. */
const GROWING: HomeSpaceCard['grow'] = {
  growId: 'grow-1',
  name: 'Spring run',
  type: 'photoperiod',
  dayNumber: 35,
  phaseDay: null,
  stageWeek: null,
  stage: null,
  stagesReached: [],
  preset: null,
  isAuto: false,
  plantCount: null,
  strains: [],
  coverMediaId: null,
  stageGroups: [],
};

const overviewOf = (spaceId: string, name: string): SpaceOverview =>
  ({
    ...card(spaceId, name),
    setpoints: [{ metric: 'temperature', value: 25, band: 1 }],
    targets: { day: [{ metric: 'temperature', value: 25, band: 1 }], night: [{ metric: 'temperature', value: 21, band: 1 }] },
    verdict: null,
    grows: [],
    cameras: [],
    entries: [],
    readingNames: [],
    people: [],
  }) as unknown as SpaceOverview;

const timeline = (spaceId: string, name: string): SpaceTimeline => ({
  spaceId,
  name,
  kind: 'tent',
  range: '24h',
  growId: null,
  dayFrom: null,
  dayTo: null,
  startsAt: ago(24 * 60),
  endsAt: ago(0),
  stepSeconds: 180,
  deviceIds: null,
  panels: [{ metric: 'temperature', points: [{ measuredAt: ago(60), value: 25 }], targets: [] }],
  lastReadingAt: ago(60),
  nights: [],
  alarms: [],
  outputs: [],
  events: [],
  machineEvents: { shown: 0, total: 0 },
  grows: [],
  readingNames: [],
  cameras: [],
  people: [],
});

/** The grow a cockpit's grow block opens, standing in the first place. */
const grow: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  description: null,
  type: 'photoperiod',
  phases: [],
  placements: [{ id: 'placement-1', spaceId: 'space-1', startedAt: ago(34 * 24 * 60), endedAt: null, plantIds: null }],
  scheme: null,
  measurements: [],
  visibility: 'private',
  slug: 'spring-run',
  coverMediaId: null,
  filmMediaId: null,
  startedAt: ago(34 * 24 * 60),
  endedAt: null,
  isDemo: false,
  createdAt: ago(34 * 24 * 60),
  updatedAt: ago(60),
  summary: {
    dayNumber: 35,
    stage: null,
    preset: null,
    phaseDay: null,
    weekNumber: 5,
    stageWeek: null,
    isAuto: false,
    groups: [],
    locations: [{ spaceId: 'space-1', plantIds: [] }],
  },
};

const meOf = (diary: boolean, layoutSeen: LayoutSeen | null): Me =>
  ({
    id: 'user-1',
    email: 'login@example.org',
    handle: 'you',
    preferences: { units: {}, locale: 'en', timezone: 'UTC', timezoneChosen: true, diary: null, notifyLaterUntil: null, layoutSeen },
    notifications: {
      channels: { email: 'login@example.org', telegram: null, webhook: null },
      routing: { alerts: ['email'] },
      quietHours: null,
      mutedUntil: null,
    },
    pushSubscribed: false,
    layers: { diary },
  }) as unknown as Me;

const server = {
  places: [['space-1', 'Fridge 1']] as [string, string][],
  diary: false,
  cameras: 0,
  /** Whether the places hold targets, so that one in its band says so. */
  targets: false,
  /** Whether a grow stands in the first place. */
  growing: false,
  /** Whether the first two places stand in a room. */
  room: false,
  youMay: 'own' as AccessNeed,
  me: meOf(false, { diary: false, places: false }),
  sent: [] as { method: string; path: string; body: unknown }[],
};

const home = (): HomeAnswer => ({
  spaces: server.places.map(([id, name]) => card(id, name)),
  followedGrows: [],
  people: [],
  layers: { diary: server.diary },
});

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const path = pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
  server.sent.push({ method, path, body });

  if (path === '/me' && method === 'PATCH') {
    // The preferences are written field by field: what a body leaves out is kept.
    server.me = { ...server.me, preferences: { ...server.me.preferences, ...(body as Me).preferences } };
    return json(server.me);
  }
  if (path === '/me') return json(server.me);
  if (path === '/home') return json(home());
  if (path === '/grows/grow-1') return json(grow);
  if (path === '/devices') return json({ items: server.places.map(([id]) => device(`device-${id.slice(-1)}`, id)), nextCursor: null });
  if (path === '/cameras')
    return json({ items: Array.from({ length: server.cameras }, (_, index) => ({ id: `cam-${index}`, spaceId: 'space-1' })), nextCursor: null });
  if (path === '/spaces') {
    const room = server.room ? [spaceWhere(server.youMay, { id: 'room-1', name: 'Cellar', kind: 'room' })] : [];
    return json(spacePage(...server.places.map(([id, name]) => spaceWhere(server.youMay, { id, name })), ...room));
  }
  const live = /^\/devices\/([^/]+)\/live$/.exec(path);
  if (live) {
    const output = { value: 0, measuredAt: ago(0.2), state: 'live' };
    return json({
      deviceId: live[1],
      metrics: {},
      outputs: { dehumidifier: output, heater: output, co2: output, light: { ...output, value: 100 } },
      setpoints: { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 }, active: 'day' },
    });
  }
  // Nothing steers these devices, which the plan route answers as it does on the server.
  if (/^\/devices\/[^/]+\/plan$/.test(path)) return json({ status: 404, code: 'plan_not_found', title: 'Not found', detail: '', errors: [] }, 404);
  const space = /^\/spaces\/([^/]+)\/(overview|live|timeline)$/.exec(path);
  if (space) {
    const name = server.places.find(([id]) => id === space[1])?.[1] ?? 'Gone';
    return json(space[2] === 'timeline' ? timeline(space[1], name) : overviewOf(space[1], name));
  }

  return json({ items: [], nextCursor: null });
});

const open = (path: string) => {
  const router = createMemoryRouter([{ element: <AppShell />, children: screens }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={testClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

const where = (router: ReturnType<typeof open>) => `${router.state.location.pathname}${router.state.location.search}`;

/** A page with nothing of its own to read, so what is asked of the wire is the navigation's. */
const QUIET = '/me/about';

/** The phone's bar, which the shell draws beside the rail. */
const bar = () => screen.getAllByRole('navigation', { name: 'Main navigation' }).find(nav => nav.querySelector('button, a')?.parentElement === nav)!;

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  localStorage.clear();
  who.demo = false;
  server.places = [['space-1', 'Fridge 1']];
  server.diary = false;
  server.cameras = 0;
  server.targets = false;
  server.growing = false;
  server.room = false;
  server.youMay = 'own';
  server.me = meOf(false, { diary: false, places: false });
  server.sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TWO: [string, string][] = [
  ['space-1', 'Fridge 1'],
  ['space-2', 'Tent 2'],
];

const withDiary = () => {
  server.diary = true;
  server.me = meOf(true, { diary: true, places: false });
};

/** Which item of the bar the address is marked on, or none. */
const marked = () =>
  within(bar())
    .queryAllByRole('link', { current: 'page' })
    .map(link => link.textContent);

describe('the bar', () => {
  it('has the items the account has something for and the session may use, always in one order', () => {
    const labels = (shape: Parameters<typeof tabsOf>[0], mayLog: boolean) =>
      tabsOf(shape, mayLog).map(tab => tab.labelKey.replace('shell.tabs.', ''));

    // One device, no diary: the customer the app is designed for.
    expect(labels({ diary: false, steering: true, managed: true }, true)).toEqual(['home', 'timeline', 'control']);
    expect(labels({ diary: true, steering: true, managed: true }, true)).toEqual(['home', 'grow', 'log', 'timeline', 'control']);
    // A guest who may write lines in somebody's tent steers nothing there.
    expect(labels({ diary: true, steering: true, managed: false }, true)).toEqual(['home', 'grow', 'log', 'timeline']);
    // A diary kept without hardware is the whole app.
    expect(labels({ diary: true, steering: false, managed: false }, true)).toEqual(['home', 'grow', 'log']);
    // The demo reads everything and writes nothing.
    expect(labels({ diary: true, steering: true, managed: false }, false)).toEqual(['home', 'grow', 'timeline']);
  });

  it('draws Start, Verlauf and Steuerung for an account with one device, and no Tasks', async () => {
    open(QUIET);

    await waitFor(() => expect(server.sent.some(one => one.path === '/spaces')).toBe(true));
    expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Control']);
    expect(
      within(bar())
        .getAllByRole('link')
        .map(link => link.getAttribute('href')),
    ).toEqual(['/', '/timeline', '/control']);
  });

  it('brings Grow and the green Log button once a diary is kept', async () => {
    withDiary();
    open(QUIET);

    await waitFor(() => expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Grow', 'Log', 'Timeline', 'Control']));
    expect(within(bar()).getByRole('button', { name: 'Log' })).toBeInTheDocument();
    expect(within(bar()).getByRole('link', { name: 'Grow' })).toHaveAttribute('href', '/grow');
  });

  it('offers a member who may only write lines no Steuerung', async () => {
    withDiary();
    server.youMay = 'log';
    open(QUIET);

    await waitFor(() => expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Grow', 'Log', 'Timeline']));
  });

  it('keeps Start marked on a place´s own page, and Steuerung on the pages below it and on the devices', async () => {
    server.places = TWO;
    const router = open('/spaces/space-2');

    await waitFor(() => expect(marked()).toEqual(['Home']));
    for (const address of ['/control/alarms?space=space-2', '/devices/device-2', '/claim', '/cameras/add']) {
      await act(() => router.navigate(address));
      await waitFor(() => expect(marked()).toEqual(['Control']));
    }
  });

  it('marks nothing on Meldungen, on Ich and on a camera´s page', async () => {
    const router = open('/alerts');

    await waitFor(() => expect(server.sent.some(one => one.path === '/spaces')).toBe(true));
    for (const address of ['/alerts', '/me/about', '/cameras/cam-1']) {
      await act(() => router.navigate(address));
      expect(marked()).toEqual([]);
    }
  });

  it('marks nothing on the task list, which is Meldungen´s, and Grow on the grows and on one of them', async () => {
    withDiary();
    const router = open('/tasks');

    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    expect(marked()).toEqual([]);
    await act(() => router.navigate('/grows'));
    expect(await screen.findByRole('heading', { level: 1, name: 'My grows' })).toBeInTheDocument();
    expect(marked()).toEqual(['Grow']);
    await act(() => router.navigate('/grows/grow-1'));
    expect(await screen.findByRole('heading', { level: 1, name: /Spring run/ })).toBeInTheDocument();
    expect(marked()).toEqual(['Grow']);
  });

  it('leads back from the task list to Meldungen, whose door opens it', async () => {
    withDiary();
    open('/tasks');

    const title = await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    expect(within(title.closest('header')!).getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');
  });

  it('draws the shape this account had last time before its answers are in, rather than jumping by an item', async () => {
    localStorage.setItem('terp.shape.user-1', JSON.stringify({ diary: true, places: 1, steering: true, managed: false, cameras: 0 }));
    withDiary();
    open(QUIET);

    expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Grow', 'Log', 'Timeline']);
  });
});

describe('a place´s page', () => {
  it('hands an only place´s own address to Start, which is that place', async () => {
    const router = open('/spaces/space-1');

    await waitFor(() => expect(where(router)).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Fridge 1' })).toBeInTheDocument();
  });

  it('has no tabs of its own, and the way back to the cards where there are several', async () => {
    server.places = TWO;
    open('/spaces/space-2');

    expect(await screen.findByRole('heading', { name: 'Tent 2' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Home', current: false })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('opens who else is let in under the place´s own name, with the way back to it', async () => {
    open('/spaces/space-1/members');

    expect(await screen.findByRole('heading', { name: /Members & sharing/ })).toHaveTextContent('Fridge 1');
    expect(screen.getByRole('link', { name: 'Back to Fridge 1' })).toHaveAttribute('href', '/spaces/space-1');
  });
});

describe('the choice of place', () => {
  /** The chip that names the chosen place: the phone´s header draws it over the pages it holds for, the rail always. */
  const chips = (name: string) => screen.queryAllByRole('button', { name: `Place: ${name}` });

  /** The places whose Timeline was read, each once. */
  const timelinesAsked = () => [...new Set(server.sent.flatMap(one => /^\/spaces\/([^/]+)\/timeline$/.exec(one.path)?.[1] ?? []))];

  it('is not offered with one place: the page says what it is and nothing is there to choose', async () => {
    open('/control');

    expect(await screen.findByRole('heading', { level: 1, name: 'Control' })).toBeInTheDocument();
    await waitFor(() => expect(server.sent.some(one => one.path === '/devices/device-1/live')).toBe(true));
    expect(screen.queryByRole('button', { name: /^Place:/ })).not.toBeInTheDocument();
  });

  it('stands in the phone´s header on the pages it holds for, and on the rail on every page', async () => {
    server.places = TWO;
    const router = open('/');

    await waitFor(() => expect(chips('Fridge 1')).toHaveLength(1));
    expect(chips('Fridge 1')[0].closest('nav')).not.toBeNull();
    for (const address of ['/timeline', '/control', '/control/alarms', '/grow', '/charts']) {
      await act(() => router.navigate(address));
      expect(chips('Fridge 1')).toHaveLength(2);
    }
    await act(() => router.navigate('/grows'));
    expect(chips('Fridge 1')).toHaveLength(1);
  });

  it('lists the places under their rooms, each saying how it is and what grows there, with the chosen one marked', async () => {
    server.places = [...TWO, ['space-3', 'Balcony']];
    server.room = true;
    server.targets = true;
    server.growing = true;
    withDiary();
    open('/timeline');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Place: Fridge 1' }))[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Place' });
    expect(within(sheet).getByText('holds for Grow, Timeline and Control')).toBeInTheDocument();

    const room = await within(sheet).findByRole('region', { name: 'Cellar' });
    const [fridge, tent] = within(room).getAllByRole('button');
    expect(fridge).toHaveAttribute('aria-current', 'true');
    expect(fridge).toHaveTextContent('Fridge 1');
    await waitFor(() => expect(fridge).toHaveTextContent('All on target'));
    expect(fridge).toHaveTextContent('Spring run, Day 35');
    expect(within(fridge).getByRole('img', { name: 'chosen' })).toBeInTheDocument();
    expect(tent).toHaveTextContent('Tent 2');
    expect(tent).not.toHaveAttribute('aria-current');
    // A place standing in no room is listed under none.
    expect(
      within(sheet)
        .getByRole('button', { name: /Balcony/ })
        .closest('section'),
    ).toBeNull();
  });

  it('moves the page to the place chosen, and the other pages follow it', async () => {
    server.places = TWO;
    const router = open('/control');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Place: Fridge 1' }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Place' })).getByRole('button', { name: /Tent 2/ }));

    await waitFor(() => expect(where(router)).toBe('/control?space=space-2'));
    expect(screen.queryByRole('dialog', { name: 'Place' })).not.toBeInTheDocument();
    await waitFor(() => expect(chips('Tent 2')).toHaveLength(2));
    expect(localStorage.getItem('terp.place')).toBe('space-2');

    fireEvent.click(within(bar()).getByRole('link', { name: 'Timeline' }));
    await waitFor(() => expect(where(router)).toBe('/timeline'));
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-2']));
    expect(chips('Tent 2')).toHaveLength(2);
  });

  it('is set by a link that names a place, and drops what the address said about the place being left', async () => {
    server.places = TWO;
    const router = open('/control/alarms?space=space-2&rule=rule-1');

    await waitFor(() => expect(chips('Tent 2')).toHaveLength(2));
    expect(localStorage.getItem('terp.place')).toBe('space-2');

    fireEvent.click(chips('Tent 2')[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Place' })).getByRole('button', { name: /Fridge 1/ }));
    await waitFor(() => expect(where(router)).toBe('/control/alarms?space=space-1'));
  });

  it('is set by opening a place from Start', async () => {
    server.places = TWO;
    const router = open('/spaces/space-2');

    await waitFor(() => expect(chips('Tent 2')).toHaveLength(1));
    await act(() => router.navigate('/timeline'));
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-2']));
  });

  it('holds from the rail on a page that is about no place, for the page opened next', async () => {
    server.places = TWO;
    const router = open(QUIET);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Place: Fridge 1' }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Place' })).getByRole('button', { name: /Tent 2/ }));

    await waitFor(() => expect(chips('Tent 2')).toHaveLength(1));
    expect(where(router)).toBe(QUIET);
    await act(() => router.navigate('/timeline'));
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-2']));
  });

  it('opens the Log sheet on the place the page shows', () => {
    expect(openingOf('/control/alarms', '?space=space-2', { current: 'space-1' })).toEqual({ spaceId: 'space-2', underneath: true });
    expect(openingOf('/timeline', '', { current: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/grow', '', { current: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/grows', '', { current: 'space-1' })).toEqual({});
    expect(openingOf('/', '', { only: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/', '', {})).toEqual({});
  });
});

describe('Grow, the bar´s item', () => {
  beforeEach(() => {
    withDiary();
    server.places = TWO;
  });

  it('is the grow running in the chosen place, with the way to every grow', async () => {
    server.growing = true;
    open('/grow');

    expect(await screen.findByRole('heading', { level: 1, name: /Spring run/ })).toBeInTheDocument();
    expect(within(bar()).getByRole('link', { name: 'Grow' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Back to My grows' })).toHaveAttribute('href', '/grows');
    // The tab it stands on is this address, so it reads as the one that is open.
    expect(screen.getByRole('link', { name: 'Weeks' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers to start a grow where none runs in the chosen place', async () => {
    server.growing = true;
    const router = open('/grow?space=space-2');

    expect(await screen.findByRole('heading', { level: 1, name: 'Grow' })).toBeInTheDocument();
    expect(screen.getByText('Nothing growing here yet')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Start a grow' })).toHaveAttribute('href', '/grows/new?space=space-2');
    expect(where(router)).toBe('/grow?space=space-2');
  });
});

describe('a change to the shape of the app', () => {
  const patches = () => server.sent.filter(one => one.method === 'PATCH' && one.path === '/me');

  it('records an account seen for the first time as it stands, and says nothing', async () => {
    server.me = meOf(false, null);
    open(QUIET);

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: false } } });
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('says once that a second place turned Start into cards and put the chosen place into the header', async () => {
    server.places = TWO;
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('There are 2 places now');
    expect(notice).toHaveTextContent('The place named at the top holds for Grow, Timeline and Control');
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: true } } });

    fireEvent.click(within(notice).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });

  it('says once that the diary brought Grow and the Log button, and where it is turned off', async () => {
    server.diary = true;
    server.me = meOf(true, { diary: false, places: false });
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('The grow diary is on. The bar now has “Grow” with the diary and “Log”');
    expect(within(notice).getByRole('link', { name: 'Turn it off under Me › Appearance' })).toHaveAttribute('href', '/me/appearance');
  });

  it('records what went away without a word, because the grower did it', async () => {
    server.me = meOf(false, { diary: true, places: true });
    open(QUIET);

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: false } } });
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('asks the demo nothing and tells it nothing', async () => {
    who.demo = true;
    open(QUIET);

    await waitFor(() => expect(server.sent.some(one => one.path === '/home')).toBe(true));
    await waitFor(() => expect(server.sent.some(one => one.path === '/spaces')).toBe(true));
    expect(patches()).toHaveLength(0);
    // The demo has no account: asking for one is answered 403 on every page, so the shell does not ask.
    expect(server.sent.filter(one => one.path === '/me')).toEqual([]);
  });
});

describe('the place menu', () => {
  it('renames the place under the name every screen calls it by', async () => {
    open('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fridge 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: 'Blue Dream' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() =>
      expect(server.sent.find(one => one.method === 'PATCH' && one.path === '/spaces/space-1')?.body).toEqual({ name: 'Blue Dream' }),
    );
  });

  it('offers a member who may only log who else is here, and nothing that would change the place', async () => {
    server.youMay = 'log';
    open('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fridge 1' }));
    expect(await screen.findByRole('link', { name: 'Invite members' })).toHaveAttribute('href', '/spaces/space-1/members');
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Maintenance/ })).not.toBeInTheDocument();
  });
});
