import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessNeed,
  Camera,
  Device,
  GrowListItem,
  HomeAnswer,
  HomeSpaceCard,
  LayoutSeen,
  Me,
  SpaceOverview,
  SpaceTimeline,
} from '@fg2/shared-types/v1';
import { expectLayout, takeExpected } from '@/api/layers';
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
  events: [],
  latestStill: null,
  openAlerts:
    server.alerting === spaceId
      ? [{ alertId: 'alert-1', kind: 'threshold', severity: 'warning', startedAt: ago(30), value: 38, metric: 'humidity', name: 'Too dry' }]
      : [],
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
    events: [],
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
  deviceId: null,
  reading: null,
  panels: [{ metric: 'temperature', points: [{ measuredAt: ago(60), value: 25 }], targets: [] }],
  lastReadingAt: ago(60),
  nights: [],
  silences: [],
  alarms: [],
  outputs: [],
  events: [],
  stretches: [],
  deviceChanges: [],
  machineEvents: { shown: 0, total: 0 },
  grows: [],
  readingNames: [],
  cameras: [],
  people: [],
});

/** The grow a place's Start opens, standing in the first place. */
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
    zone: 'UTC',
    stageWeek: null,
    isAuto: false,
    groups: [],
    locations: [{ spaceId: 'space-1', plantIds: [] }],
  },
};

/** A grow running in the second place, and one that ended there: opened by their ids. */
const growInTent: GrowListItem = {
  ...grow,
  id: 'grow-2',
  name: 'Tent run',
  placements: [{ id: 'placement-2', spaceId: 'space-2', startedAt: ago(10 * 24 * 60), endedAt: null, plantIds: null }],
  summary: { ...grow.summary, locations: [{ spaceId: 'space-2', plantIds: [] }] },
};
const growOver: GrowListItem = {
  ...grow,
  id: 'grow-9',
  name: 'Last year',
  endedAt: ago(24 * 60),
  placements: [{ id: 'placement-9', spaceId: 'space-2', startedAt: ago(90 * 24 * 60), endedAt: ago(24 * 60), plantIds: null }],
  summary: { ...grow.summary, locations: [] },
};
const GROWS: Record<string, GrowListItem> = { 'grow-1': grow, 'grow-2': growInTent, 'grow-9': growOver };

/** A camera standing in the second place. */
const camera = {
  id: 'cam-2',
  createdAt: ago(60),
  ownerId: 'user-1',
  kind: 'terpcam_controller',
  staleWarning: true,
  deviceId: 'device-2',
  spaceId: 'space-2',
  name: 'Tent cam',
  looksAt: 'canopy',
  plantIds: [],
  did: 'SIMCAM',
  uid: null,
  ip: null,
  url: null,
  transport: null,
  tunnel: false,
  model: 'terp_cam',
  stillIntervalSeconds: 30,
  nightOff: false,
  maintenanceOff: false,
  logErrors: true,
  entitlement: { validUntil: ago(-365 * 24 * 60), grant: 'included', tier: 'premium', renewalVisible: false },
  isDemo: false,
  removedAt: null,
  state: { lastStillAt: ago(1), lastError: null, firmwareVersion: null },
} as unknown as Camera;

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
    premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
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
  /** Whether a grow stands in no place, beside the places. */
  loose: false,
  /** Whether the first two places stand in a room. */
  room: false,
  /** The place an alert is open in, which Start then lists first. */
  alerting: null as string | null,
  /** The account's own places that have ended, which only the list asked for them names. */
  ended: [] as [string, string][],
  /** The grows the lists answer: every one of the account, which a place then asks for its own of. */
  grows: [] as GrowListItem[],
  youMay: 'own' as AccessNeed,
  me: meOf(false, { diary: false, places: false }),
  sent: [] as { method: string; path: string; body: unknown }[],
};

const home = (): HomeAnswer => ({
  spaces: [
    ...server.places.map(([id, name]) => card(id, name)),
    ...(server.loose ? [{ ...card('space-0', 'Spring run'), spaceId: null, deviceIds: [], values: [], grow: GROWING } as HomeSpaceCard] : []),
  ],
  followedGrows: [],
  people: [],
  layers: { diary: server.diary },
});

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname, searchParams } = new URL(String(input), 'http://localhost');
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
  // The shelf of schemes the app ships, which the page of every grow says a line about.
  if (pathname === '/assets/schemes/index.json') return json({ schemes: [] });
  if (path === '/grows') {
    const spaceId = searchParams.get('spaceId');
    const ended = searchParams.get('including') === 'ended';
    const items = server.grows.filter(
      one =>
        (spaceId === null || one.placements.some(placement => placement.spaceId === spaceId)) && (spaceId === null || ended || one.endedAt === null),
    );
    return json({ items, nextCursor: null });
  }
  const byId = /^\/grows\/([^/]+)$/.exec(path);
  if (byId && GROWS[byId[1]]) return json(GROWS[byId[1]]);
  if (path === '/cameras/cam-2') return json(camera);
  // Leaving is answered as the server does it: the place is off the reader's lists from then on.
  if (method === 'DELETE' && /^\/spaces\/[^/]+\/members\/user-1$/.test(path)) server.places = [];
  if (/^\/spaces\/[^/]+\/members$/.test(path)) {
    const mine = server.youMay === 'own' ? [] : [{ id: 'row-1', spaceId: 'space-1', userId: 'user-1', role: 'can_log', inviteId: null }];
    return json({ items: mine, people: [{ id: 'user-1', handle: 'you' }], room: null, activity: [], nextCursor: null });
  }
  if (/^\/devices\/[^/]+\/sockets$/.test(path)) return json({ items: [], nextCursor: null, capabilities: {} });
  if (path === '/devices') return json({ items: server.places.map(([id]) => device(`device-${id.slice(-1)}`, id)), nextCursor: null });
  if (path === '/cameras')
    return json({ items: Array.from({ length: server.cameras }, (_, index) => ({ id: `cam-${index}`, spaceId: 'space-1' })), nextCursor: null });
  if (path === '/spaces' && searchParams.get('archived')) {
    return json(spacePage(...server.ended.map(([id, name]) => ({ ...spaceWhere('own', { id, name }), archivedAt: ago(60) }))));
  }
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
    if (space[2] === 'live') return json({ spaceId: space[1], values: overviewOf(space[1], name).values, setpoints: [], devices: [], cameras: [] });
    return json(space[2] === 'timeline' ? timeline(space[1], name) : overviewOf(space[1], name));
  }

  return json({ items: [], nextCursor: null });
});

/** The client of the app last opened. */
let client = testClient();

const open = (path: string) => {
  const router = createMemoryRouter([{ element: <AppShell />, children: screens }], { initialEntries: [path] });
  client = testClient();
  render(
    <QueryClientProvider client={client}>
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
  server.loose = false;
  server.grows = [];
  server.room = false;
  server.alerting = null;
  server.ended = [];
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
    for (const address of ['/control/alarms?space=space-2', '/devices/device-2', '/cameras/add']) {
      await act(() => router.navigate(address));
      await waitFor(() => expect(marked()).toEqual(['Control']));
      // The rail marks what the bar marks: one rule for both.
      const rail = screen.getAllByRole('navigation', { name: 'Main navigation' }).find(nav => nav !== bar())!;
      expect(
        within(rail)
          .queryAllByRole('link', { current: 'page' })
          .map(link => link.textContent),
      ).toEqual(['Control']);
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Grows' })).toBeInTheDocument();
    expect(marked()).toEqual(['Grow']);
    await act(() => router.navigate('/grows/grow-1'));
    expect(await screen.findByRole('heading', { level: 1, name: /Spring run/ })).toBeInTheDocument();
    expect(marked()).toEqual(['Grow']);
  });

  it('leads from Meldungen to the task list, and from the list opened by its address back to Meldungen', async () => {
    withDiary();
    const router = open('/alerts');

    fireEvent.click(await screen.findByRole('link', { name: 'All tasks and reminders ›' }));
    expect(where(router)).toBe('/tasks');
    const title = await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    expect(within(title.closest('header')!).getByRole('link', { name: 'Back to Alerts' })).toHaveAttribute('href', '/alerts');
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

  it('opens who else is let in for a member, under the place´s own name with the way back to it', async () => {
    server.youMay = 'log';
    open('/spaces/space-1/members');

    expect(await screen.findByRole('heading', { level: 1, name: 'Who sees Fridge 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back: Fridge 1' })).toHaveAttribute('href', '/spaces/space-1');
  });

  it('answers the address of who is let in with the page that edits the place, for whoever manages it', async () => {
    const router = open('/spaces/space-1/members');

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit place' })).toBeInTheDocument();
    expect(where(router)).toBe('/spaces/space-1/edit');
  });
});

describe('the choice of place', () => {
  /** The chip that names the chosen place: the phone´s header draws it on the pages of Grow, Verlauf and Steuerung, the rail always. */
  const chips = (name: string) => screen.queryAllByRole('button', { name: `Place: ${name}` });
  const chosen = () => localStorage.getItem('terp.place');
  const choose = async (from: string, to: RegExp) => {
    fireEvent.click((await screen.findAllByRole('button', { name: `Place: ${from}` }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Place' })).getByRole('button', { name: to }));
  };

  /** The places whose Timeline was read, each once. */
  const timelinesAsked = () => [...new Set(server.sent.flatMap(one => /^\/spaces\/([^/]+)\/timeline$/.exec(one.path)?.[1] ?? []))];

  beforeEach(() => {
    server.places = TWO;
  });

  it('is not offered with one place: the page says what it is and nothing is there to choose', async () => {
    server.places = [['space-1', 'Fridge 1']];
    open('/control');

    expect(await screen.findByRole('heading', { level: 1, name: 'Control' })).toBeInTheDocument();
    await waitFor(() => expect(server.sent.some(one => one.path === '/devices/device-1/live')).toBe(true));
    expect(screen.queryByRole('button', { name: /^Place:/ })).not.toBeInTheDocument();
  });

  it('stands in the phone´s header on every address of Grow, Verlauf and Steuerung, and on the rail on every page', async () => {
    withDiary();
    server.growing = true;
    const router = open('/');

    await waitFor(() => expect(chips('Fridge 1')).toHaveLength(1));
    for (const address of ['/timeline', '/control', '/control/alarms', '/grow', '/grow/plants']) {
      await act(() => router.navigate(address));
      expect(chips('Fridge 1')).toHaveLength(2);
    }
    // A page about one grow, about every grow or about none of them is not about the chosen place.
    for (const address of ['/grows', '/grows/grow-9/weeks', QUIET]) {
      await act(() => router.navigate(address));
      expect(chips('Fridge 1')).toHaveLength(1);
    }
  });

  it('heads the group of Grow, Verlauf and Steuerung on the rail, apart from Start', async () => {
    withDiary();
    open(QUIET);

    const [chip] = await screen.findAllByRole('button', { name: 'Place: Fridge 1' });
    const group = chip.parentElement!;
    expect(group.firstElementChild).toBe(chip);
    expect(
      within(group)
        .getAllByRole('link')
        .map(link => link.textContent),
    ).toEqual(['Grow', 'Timeline', 'Control']);
  });

  it('opens a browser that has chosen none on the place Start lists first, and lists the places in that order', async () => {
    server.alerting = 'space-2';
    server.places = [...TWO, ['space-3', 'Balcony']];
    server.room = true;
    open('/timeline');

    // The place that needs a person, not the first the account set up.
    await waitFor(() => expect(chips('Tent 2')).toHaveLength(2));
    expect(chosen()).toBe('space-2');
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-2']));

    // A button that opens a sheet says so, and whether it is open.
    const [chip] = chips('Tent 2');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chip);
    const sheet = await screen.findByRole('dialog', { name: 'Place' });
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    const rows = await within(sheet).findAllByRole('button', { name: /Tent 2|Fridge 1|Balcony/ });
    expect(rows.map(row => /Tent 2|Fridge 1|Balcony/.exec(row.textContent)![0])).toEqual(['Tent 2', 'Fridge 1', 'Balcony']);
  });

  it('opens a browser that has chosen none on the place a grow runs in, before one that only needs a person', async () => {
    // Tent 2 has an alert open and is what Start lists first; the grow runs in Fridge 1.
    server.alerting = 'space-2';
    server.growing = true;
    open('/timeline');

    await waitFor(() => expect(chips('Fridge 1')).toHaveLength(2));
    expect(chosen()).toBe('space-1');
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
    expect(within(sheet).getByText('applies to Grow, Timeline and Control')).toBeInTheDocument();

    const room = await within(sheet).findByRole('region', { name: 'Cellar' });
    const [fridge, tent] = within(room).getAllByRole('button');
    expect(fridge).toHaveAttribute('aria-current', 'true');
    expect(fridge).toHaveTextContent('Fridge 1');
    await waitFor(() => expect(fridge).toHaveTextContent('All on target'));
    expect(fridge).toHaveTextContent('Spring run, Day 35');
    expect(within(fridge).getByRole('img', { name: 'chosen' })).toBeInTheDocument();
    expect(tent).toHaveTextContent('Tent 2');
    expect(tent).not.toHaveAttribute('aria-current');
    // A place standing in no room is listed under none, and set off from the room before it.
    const balcony = within(sheet).getByRole('button', { name: /Balcony/ });
    expect(balcony.closest('section')).toBeNull();
    expect(balcony).toHaveAttribute('data-apart');
  });

  it.each([
    ['its Start', '/spaces/space-2'],
    ['a grow running there', '/grows/grow-2'],
    ['its camera', '/cameras/cam-2'],
    ['one of its devices', '/devices/device-2'],
  ])('is set by opening a page that belongs to a place: %s', async (_what, address) => {
    localStorage.setItem('terp.place', 'space-1');
    open(address);

    await waitFor(() => expect(chosen()).toBe('space-2'));
    // The rail never names a place the page beside it is not about.
    await waitFor(() => expect(chips('Tent 2')).toHaveLength(1));
    expect(chips('Fridge 1')).toHaveLength(0);
  });

  it.each([
    ['a grow that has ended', '/grows/grow-9'],
    ['every grow', '/grows'],
    ['Ich', QUIET],
  ])('is left alone by a page that belongs to no place: %s', async (_what, address) => {
    withDiary();
    localStorage.setItem('terp.place', 'space-1');
    open(address);

    await waitFor(() => expect(chips('Fridge 1')).toHaveLength(1));
    await waitFor(() => expect(server.sent.some(one => one.path === '/spaces')).toBe(true));
    expect(chosen()).toBe('space-1');
  });

  it.each([
    ['Steuerung', '/control?space=space-2', '/control?space=space-1'],
    // A page below Steuerung stays that page: the other place has its alarms too. What named a rule of the place left goes.
    ['Steuerung, on a page below it', '/control/alarms?space=space-2&rule=rule-1', '/control/alarms?space=space-1'],
    ['Verlauf', '/timeline?space=space-2&focus=humidity', '/timeline?space=space-1'],
    ['Grow, on one of its tabs', '/grow/plants?space=space-2', '/grow?space=space-1'],
  ])('keeps the item and shows it for the place chosen: %s', async (_what, from, to) => {
    withDiary();
    server.growing = true;
    const router = open(from);

    await waitFor(() => expect(chosen()).toBe('space-2'));
    await choose('Tent 2', /Fridge 1/);

    await waitFor(() => expect(where(router)).toBe(to));
    expect(screen.queryByRole('dialog', { name: 'Place' })).not.toBeInTheDocument();
    await waitFor(() => expect(chips('Fridge 1')).toHaveLength(2));
    expect(chosen()).toBe('space-1');
  });

  it.each([['its camera', '/cameras/cam-2']])(
    'leads from a page that belongs to a place to the Start of the place chosen: %s',
    async (_what, from) => {
      const router = open(from);

      await waitFor(() => expect(chosen()).toBe('space-2'));
      await choose('Tent 2', /Fridge 1/);

      await waitFor(() => expect(where(router)).toBe('/spaces/space-1'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
      expect(chosen()).toBe('space-1');
    },
  );

  it('leads from a grow opened by its id to Grow of the place chosen', async () => {
    const router = open('/grows/grow-2');

    await waitFor(() => expect(chosen()).toBe('space-2'));
    await choose('Tent 2', /Fridge 1/);

    await waitFor(() => expect(where(router)).toBe('/grow?space=space-1'));
    expect(chosen()).toBe('space-1');
  });

  it('only changes the choice on a page that belongs to no place, and the page opened next follows it', async () => {
    const router = open(QUIET);

    await choose('Fridge 1', /Tent 2/);

    await waitFor(() => expect(chips('Tent 2')).toHaveLength(1));
    expect(where(router)).toBe(QUIET);
    fireEvent.click(within(bar()).getByRole('link', { name: 'Timeline' }));
    await waitFor(() => expect(where(router)).toBe('/timeline'));
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-2']));
    expect(chips('Tent 2')).toHaveLength(2);
  });

  /** An unknown `space=` is an address that names nothing, as an unknown place, grow or device is: said, and no other place drawn in its stead. */
  it.each([
    ['/control/alarms?space=somebody-elses&rule=rule-1', 'Control'],
    ['/control?space=somebody-elses', 'Control'],
    ['/timeline?space=somebody-elses', 'Timeline'],
    ['/grow?space=somebody-elses', 'Grow'],
  ])('says at %s that a place the account has not got cannot be opened, keeps the address and leaves the chosen one', async address => {
    localStorage.setItem('terp.place', 'space-2');
    const router = open(address);

    expect(await screen.findByRole('alert')).toHaveTextContent('This place cannot be opened.');
    expect(screen.getByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(where(router)).toBe(address);
    expect(timelinesAsked()).toEqual([]);
    expect(chosen()).toBe('space-2');
  });

  /** An old alert and a bookmark still name a place that was removed: the page says so, and draws no other place in its stead. */
  it('says at /control that a place of the account´s own has ended, keeps the address and leads to Start', async () => {
    server.ended = [['space-9', 'Old tent']];
    const router = open('/control?space=space-9');

    expect(await screen.findByText('The place Old tent no longer exists. Its curves can still be read in the Timeline.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Control' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(where(router)).toBe('/control?space=space-9');
    expect(timelinesAsked()).toEqual([]);
  });

  /** Its curves stay its owner's to read: Verlauf draws them, says the place has ended and offers nothing that writes. */
  it('draws at /timeline the curves of a place of the account´s own that has ended, read only', async () => {
    server.ended = [['space-9', 'Old tent']];
    const router = open('/timeline?space=space-9');

    expect(
      await screen.findByText('The place Old tent no longer exists. Its curves can still be read here; nothing can be changed any more.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Timeline' })).toBeInTheDocument();
    expect(where(router)).toBe('/timeline?space=space-9');
    await waitFor(() => expect(timelinesAsked()).toEqual(['space-9']));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
    expect(screen.queryByText('Share')).not.toBeInTheDocument();
    expect(screen.queryByText('Views')).not.toBeInTheDocument();
  });

  it('opens the Log sheet on the place the page shows', () => {
    expect(openingOf('/control/alarms', '?space=space-2', { current: 'space-1' })).toEqual({ spaceId: 'space-2', underneath: true });
    expect(openingOf('/timeline', '', { current: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/grow/plants', '', { current: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/grows', '', { current: 'space-1' })).toEqual({});
    expect(openingOf('/charts', '?grow=grow-9', { current: 'space-1' })).toEqual({});
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
    // A root of the bar: nothing leads back from it, and every grow is a tap beside its name.
    expect(screen.getByRole('link', { name: 'All grows' })).toHaveAttribute('href', '/grows');
    expect(screen.queryByRole('link', { name: /^Back to/ })).not.toBeInTheDocument();
  });

  it('keeps the grow´s tabs under its own address, so the page stays the chosen place´s', async () => {
    server.growing = true;
    const router = open('/grow');

    const tabs = within(await screen.findByRole('navigation', { name: 'Grow page' }));
    expect(tabs.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/grow',
      '/grow/pictures',
      '/grow/plants',
      '/grow/feeding',
      '/grow/report',
    ]);
    expect(tabs.getByRole('link', { name: 'Diary' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(tabs.getByRole('link', { name: 'Plants' }));
    await waitFor(() => expect(where(router)).toBe('/grow/plants'));
    expect(tabs.getByRole('link', { name: 'Plants' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: 'Diary' })).not.toHaveAttribute('aria-current');
    expect(within(bar()).getByRole('link', { name: 'Grow' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: 'Place: Fridge 1' })).toHaveLength(2);
  });

  it('sends a tab the grow has not got to the item´s own address', async () => {
    server.growing = true;
    const router = open('/grow/nonsense');

    await waitFor(() => expect(where(router)).toBe('/grow'));
  });

  it('offers to start a grow where none runs in the chosen place, in a sheet over Grow', async () => {
    server.growing = true;
    const router = open('/grow?space=space-2');

    expect(await screen.findByRole('heading', { level: 1, name: 'Grow' })).toBeInTheDocument();
    // The heading stands while the place is read; what grows there follows it.
    expect(await screen.findByText('Nothing growing here yet')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a grow' }));

    // Started here, the grow is drawn here: the address stays Grow's.
    expect(await screen.findByRole('dialog', { name: /: What grows here\?$/ })).toBeInTheDocument();
    expect(where(router)).toBe('/grow?space=space-2');
  });

  it('says after a harvest that the grow has ended and leads to its report, and offers a move only where a grow could come from', async () => {
    server.places = TWO;
    server.grows = [growOver];
    open('/grow?space=space-2');

    expect(await screen.findByRole('link', { name: 'Last year has ended · this is its report ›' })).toHaveAttribute('href', '/grows/grow-9/report');
    // Nothing runs anywhere else, so there is no grow to move here.
    expect(screen.getByRole('button', { name: 'Start a grow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move a grow here' })).not.toBeInTheDocument();
  });

  /** "Nothing growing here" over a grow on the balcony read as having none. */
  it('shows the grow standing in no place where the chosen place grows nothing', async () => {
    server.loose = true;
    open('/grow?space=space-2');

    expect(await screen.findByRole('heading', { level: 1, name: /Spring run/ })).toBeInTheDocument();
    expect(screen.queryByText('Nothing growing here yet')).not.toBeInTheDocument();
  });

  it('offers to move a grow into the chosen place where one runs somewhere else, with the only one there is chosen', async () => {
    server.places = TWO;
    server.grows = [grow];
    open('/grow?space=space-2');

    fireEvent.click(await screen.findByRole('button', { name: 'Move a grow here' }));
    const sheet = await screen.findByRole('dialog');
    // There is nothing to pick among one: it stands chosen, and the move is a tap away.
    expect(await within(sheet).findByRole('button', { name: /^Spring run/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Move · Tent 2' })).toBeEnabled();
    // What ends is the grow's time at its old place - "the open placement is closed" read as the place itself ending.
    expect(within(sheet).getByText(/^From that day the grow stands here; its time at its old place ends/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/placement|closed/)).not.toBeInTheDocument();
  });
});

describe('a change to the shape of the app', () => {
  const patches = () => server.sent.filter(one => one.method === 'PATCH' && one.path === '/me');

  /** The shape has been written and the write answered, which is when a notice would be drawn: the moment to look for none. */
  const recorded = async () => {
    await waitFor(() => expect(patches()).toHaveLength(1));
    await waitFor(() => expect(client.isMutating()).toBe(0));
  };

  it('records a new account, which owns no device yet, as it stands and says nothing', async () => {
    server.places = [];
    server.me = meOf(false, null);
    open(QUIET);

    await recorded();
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: false } } });
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('says nothing to a guest seen for the first time either: the devices there are the host´s', async () => {
    server.youMay = 'log';
    server.me = meOf(false, null);
    open(QUIET);

    await recorded();
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('tells an account from before, which owns a device and was never shown a shape, once where everything is now', async () => {
    server.me = meOf(false, null);
    open(QUIET);

    // A window without `matchMedia` counts as wide, where the bar is the rail.
    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('The app has a new layout. The bar on the left holds Home, Timeline, and Control: Timeline shows the curves');
    expect(notice).toHaveTextContent('Alerts and Me are at the bottom of it.');
    // Nothing came in for it, so nothing is said to have, and there is no diary to turn off.
    expect(notice).not.toHaveTextContent('The grow diary is on');
    expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: false } } });

    fireEvent.click(within(notice).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });

  it('names that account´s own bar on a phone, Grow included where it keeps the diary', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    server.diary = true;
    server.me = meOf(true, null);
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('The bar at the bottom holds Home, Grow, Timeline, and Control: Timeline shows the curves');
    expect(notice).toHaveTextContent('Alerts and your account are at the top right');
    // The diary was there before the layout: it is part of the bar named, and not news.
    expect(notice).not.toHaveTextContent('The grow diary is on');
  });

  it('records the account on a page drawn without the bar too, so that claiming its first device there is not taken for a life before', async () => {
    server.places = [];
    server.me = meOf(false, null);
    const router = open('/claim');

    await recorded();
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: false } } });

    // The device it then claims is its own, and still nothing is said: the shape is on record.
    server.places = [['space-1', 'Fridge 1']];
    await act(() => router.navigate(QUIET));
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });

  it('says once that a second place turned Start into cards and put the chosen place into the header', async () => {
    server.places = TWO;
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('There are 2 places now');
    expect(notice).toHaveTextContent('The place named at the top applies to Grow, Timeline and Control');
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
    expect(notice).not.toHaveTextContent('The app has a new layout');
    expect(within(notice).getByRole('link', { name: 'Turn it off under Me › Grow diary' })).toHaveAttribute('href', '/me/diary');
  });

  it('records what setup switched on itself without a word: the grower chose it on the page before', async () => {
    // Said by the claim´s last step before it starts the grow that brings the diary.
    expectLayout({ diary: true });
    server.diary = true;
    server.me = meOf(true, { diary: false, places: false });
    open(QUIET);

    await recorded();
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: true, places: false } } });
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    // The word holds for that one change: it is used up with it.
    expect(takeExpected()).toEqual({});
  });

  it('still says a second place that came with what setup switched on', async () => {
    expectLayout({ diary: true });
    server.diary = true;
    server.places = TWO;
    server.me = meOf(true, { diary: false, places: false });
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('There are 2 places now');
    expect(notice).not.toHaveTextContent('The grow diary is on');
  });

  /** Every read of the shell answered and drawn, on a page where no notice can be: the moment to look for no write. */
  const answered = async () => {
    await waitFor(() => expect(server.sent.some(one => one.path === '/me')).toBe(true));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  };

  /**
   * A second controller's claim makes a place, and its question stands without the bar, where no line is drawn. So
   * the shape is not recorded as seen there: a flow left on the question is told on the next page with the bar.
   */
  it('records a second place as seen where its line is drawn, not on the claim´s question', async () => {
    server.places = TWO;
    const router = open('/claim');
    await answered();
    expect(patches()).toHaveLength(0);

    await act(() => router.navigate(QUIET));
    expect(await screen.findByRole('status', { name: 'What changed' })).toHaveTextContent('There are 2 places now');
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: true } } });
  });

  /** The answer to where it hangs may end that place on the next page: nothing was recorded, and nothing is said about one place. */
  it('says nothing of a second place that is gone before its line could be read, and writes nothing', async () => {
    server.places = TWO;
    const router = open('/claim');
    await answered();

    server.places = [['space-1', 'Fridge 1']];
    await act(() => client.invalidateQueries());
    await act(() => router.navigate(QUIET));
    expect(await screen.findAllByRole('navigation', { name: 'Main navigation' })).not.toHaveLength(0);
    await answered();
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    expect(patches()).toHaveLength(0);
  });

  it('keeps the word about what setup switched on for the page that draws the line about the rest', async () => {
    expectLayout({ diary: true });
    server.diary = true;
    server.places = TWO;
    server.me = meOf(true, { diary: false, places: false });
    const router = open('/claim');
    await answered();
    expect(patches()).toHaveLength(0);

    await act(() => router.navigate(QUIET));
    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('There are 2 places now');
    expect(notice).not.toHaveTextContent('The grow diary is on');
  });

  it('records what went away without a word, because the grower did it', async () => {
    server.me = meOf(false, { diary: true, places: true });
    open(QUIET);

    await recorded();
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

/**
 * A host ends a place, or takes a guest out of it, while the guest has the app open. The home, read on a beat,
 * stops listing the place; the shell says so once, has everything read again, and Start does not greet the guest
 * as somebody who has just signed up.
 */
describe('a place taken out of sight while the app is open', () => {
  const beat = () => act(() => client.invalidateQueries({ queryKey: ['home'] }));
  const reads = (path: string) => server.sent.filter(one => one.method === 'GET' && one.path === path).length;

  it('tells a guest once, reads the bell´s alerts and the tasks again, and does not ask what to start with', async () => {
    server.youMay = 'log';
    withDiary();
    open('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
    await waitFor(() => expect(reads('/tasks')).toBeGreaterThan(0));
    const [alerts, tasks] = [reads('/alerts'), reads('/tasks')];

    server.places = [];
    await beat();

    expect(await screen.findByText('You no longer see Fridge 1')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'You see no place right now' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What do you start with?' })).not.toBeInTheDocument();
    await waitFor(() => expect(reads('/alerts')).toBeGreaterThan(alerts));
    expect(reads('/tasks')).toBeGreaterThan(tasks);

    // Once: the next beat finds nothing new to say.
    await beat();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getAllByText('You no longer see Fridge 1')).toHaveLength(1);
  });

  /** Left standing, the page turned into the empty account's Steuerung, which offered to add a device. */
  it('leads a guest from a page about the place that went to Start, and says it there', async () => {
    server.youMay = 'log';
    const router = open('/control?space=space-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Control' })).toBeInTheDocument();
    await waitFor(() => expect(reads('/spaces')).toBeGreaterThan(0));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    server.places = [];
    await beat();

    expect(await screen.findByText('You no longer see Fridge 1')).toBeInTheDocument();
    await waitFor(() => expect(where(router)).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'You see no place right now' })).toBeInTheDocument();
  });

  it('leaves a guest on the page of a place that is still seen when another one goes', async () => {
    server.youMay = 'log';
    server.places = [...TWO];
    const router = open('/control?space=space-2');
    expect(await screen.findByRole('heading', { level: 1, name: 'Control' })).toBeInTheDocument();
    await waitFor(() => expect(client.isFetching()).toBe(0));

    server.places = [['space-2', 'Tent 2']];
    await beat();

    expect(await screen.findByText('You no longer see Fridge 1')).toBeInTheDocument();
    expect(where(router)).toBe('/control?space=space-2');
  });

  it('names each place that went, and keeps the cards of what is still seen', async () => {
    server.youMay = 'log';
    server.places = [...TWO, ['space-3', 'Balcony']];
    open('/');
    expect(await screen.findByRole('link', { name: /Balcony/ })).toBeInTheDocument();

    server.places = [['space-3', 'Balcony']];
    await beat();

    expect(await screen.findByText('You no longer see Fridge 1 and Tent 2')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Balcony' })).toBeInTheDocument();
  });

  /** The lock screen: both reads are taken again on coming back, and the places may answer before the home does. */
  it('tells it where the places are the first to come back without the place', async () => {
    server.youMay = 'log';
    open(QUIET);
    await waitFor(() => expect(reads('/home')).toBe(1));
    await waitFor(() => expect(reads('/spaces')).toBe(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    server.places = [];
    await act(() => client.invalidateQueries({ queryKey: ['spaces'], exact: true }));

    expect(await screen.findByText('You no longer see Fridge 1')).toBeInTheDocument();
  });

  it('says nothing where the owner ends a place of their own: the page that did it has said so', async () => {
    open('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();

    server.places = [];
    await beat();

    expect(await screen.findByRole('heading', { level: 1, name: 'What do you start with?' })).toBeInTheDocument();
    expect(screen.queryByText(/You no longer see/)).not.toBeInTheDocument();
  });

  it('says nothing more to a guest who leaves: the toast of leaving names the place', async () => {
    server.youMay = 'log';
    open('/spaces/space-1/members');
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Fridge 1' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave Fridge 1?' })).getByRole('button', { name: 'Leave' }));

    expect(await screen.findByText('You have left Fridge 1')).toBeInTheDocument();
    await waitFor(() => expect(reads('/home')).toBeGreaterThan(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByText(/You no longer see/)).not.toBeInTheDocument();
  });
});

describe('the place menu', () => {
  it('leads from the ⋯ beside the name to the page that edits the place, which renames it under the name every screen calls it by', async () => {
    open('/');

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    fireEvent.click(screen.getByRole('link', { name: 'Edit place' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit place' })).toBeInTheDocument();
    // One task with one way on and one way out: the page stands without the bar.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Blue Dream' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(server.sent.find(one => one.method === 'PATCH' && one.path === '/spaces/space-1')?.body).toEqual({ name: 'Blue Dream' }),
    );
  });

  it('draws no menu for a member who may only log, and leads them to who else is here from whose place it is', async () => {
    server.youMay = 'log';
    open('/');

    // Everything behind the menu changes the place, and a menu of things one may not do is no menu.
    expect(await screen.findByRole('link', { name: /see the members$/ })).toHaveAttribute('href', '/spaces/space-1/members');
    expect(screen.queryByRole('link', { name: /^Edit place/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Maintenance/ })).not.toBeInTheDocument();
  });
});
