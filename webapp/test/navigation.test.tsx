import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, HomeAnswer, HomeSpaceCard, LayoutSeen, Me, SpaceOverview, SpaceTimeline } from '@fg2/shared-types/v1';
import { screens } from '@/app/routes';
import { AppShell } from '@/app/shell/AppShell';
import { tabsOf } from '@/app/shell/tabs';
import { openingOf } from '@/log/underneath';
import { spacePage, spaceWhere } from './session';

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/**
 * The navigation around the cockpit, drawn through the real table of addresses
 * under the real shell and answered over the wire: the same four tabs for
 * everybody, the Log button where a diary is kept, one place page with no tabs
 * of its own, Verlauf and Steuerung about one place with a switcher only where
 * there is something to switch, every address a place used to have sent on to
 * where its things are now, and a change to the shape of the app said once.
 */

const ago = (minutes: number) => DateTime.now().minus({ minutes }).toUTC().toISO()!;

const device = (id: string, spaceId: string, type: Device['type'] = 'fridge'): Device =>
  ({
    id,
    type,
    name: type,
    ownerId: 'user-1',
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
  kind: spaceId === 'space-1' ? 'fridge' : 'tent',
  roomId: null,
  deviceIds: [`device-${spaceId.slice(-1)}`],
  values: [
    { metric: 'temperature', value: 25.1, measuredAt: ago(0.3), state: 'live' },
    { metric: 'humidity', value: 61, measuredAt: ago(0.3), state: 'live' },
  ],
  setpoints: [],
  trend: null,
  grow: null,
  entries: [],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
});

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

const timeline = (spaceId: string): SpaceTimeline =>
  ({
    spaceId,
    range: '24h',
    startsAt: ago(24 * 60),
    endsAt: ago(0),
    stepSeconds: 180,
    panels: [{ metric: 'temperature', points: [{ measuredAt: ago(60), value: 25 }], targets: [] }],
    nights: [],
    alarms: [],
    outputs: [],
    events: [],
    cameras: [],
    grows: [],
  }) as unknown as SpaceTimeline;

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
  youMay: 'own' as AccessNeed,
  me: meOf(false, { diary: false, places: false }),
  sent: [] as { method: string; path: string; body: unknown }[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
  if (path === '/devices') return json({ items: server.places.map(([id]) => device(`device-${id.slice(-1)}`, id)), nextCursor: null });
  if (path === '/cameras')
    return json({ items: Array.from({ length: server.cameras }, (_, index) => ({ id: `cam-${index}`, spaceId: 'space-1' })), nextCursor: null });
  if (path === '/spaces') return json(spacePage(...server.places.map(([id, name]) => spaceWhere(server.youMay, { id, name }))));
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
  const space = /^\/spaces\/([^/]+)\/(overview|live|timeline)$/.exec(path);
  if (space) {
    const name = server.places.find(([id]) => id === space[1])?.[1] ?? 'Gone';
    return json(space[2] === 'timeline' ? timeline(space[1]) : overviewOf(space[1], name));
  }

  return json({ items: [], nextCursor: null });
});

const open = (path: string) => {
  const router = createMemoryRouter([{ element: <AppShell />, children: screens }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  localStorage.clear();
  who.demo = false;
  server.places = [['space-1', 'Fridge 1']];
  server.diary = false;
  server.cameras = 0;
  server.youMay = 'own';
  server.me = meOf(false, { diary: false, places: false });
  server.sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bar', () => {
  it('is Start, Verlauf, Steuerung and Gerät for one device and no diary, with Log only where a diary is kept and may be written', () => {
    const one = { diary: false, devices: 1 };
    expect(tabsOf(one, true).map(tab => tab.labelKey)).toEqual(['shell.tabs.home', 'shell.tabs.timeline', 'shell.tabs.control', 'shell.tabs.device']);
    expect(tabsOf({ ...one, diary: true }, true).map(tab => tab.labelKey)).toEqual([
      'shell.tabs.home',
      'shell.tabs.timeline',
      'shell.tabs.log',
      'shell.tabs.control',
      'shell.tabs.device',
    ]);
    expect(tabsOf({ ...one, diary: true }, false).some(tab => tab.raised)).toBe(false);
    expect(tabsOf({ diary: false, devices: 2 }, true).at(-1)?.labelKey).toBe('shell.tabs.devices');
  });

  it('leaves Steuerung out until there is a device to steer, and Gerät until there is anything to list', () => {
    // A diary kept without hardware is the whole app: hardware is offered under the grow and under Ich.
    expect(tabsOf({ diary: true, devices: 0, steering: false }, true).map(tab => tab.labelKey)).toEqual([
      'shell.tabs.home',
      'shell.tabs.log',
      'shell.tabs.timeline',
    ]);
    // A camera alone is listed under Gerät and steers nothing.
    expect(tabsOf({ diary: true, devices: 1, steering: false }, true).map(tab => tab.labelKey)).toEqual([
      'shell.tabs.home',
      'shell.tabs.timeline',
      'shell.tabs.log',
      'shell.tabs.device',
    ]);
  });

  it('draws the four places of an account with one device, and no Tasks', async () => {
    open(QUIET);

    await waitFor(() => expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Control', 'Device']));
    expect(
      within(bar())
        .getAllByRole('link')
        .map(link => link.getAttribute('href')),
    ).toEqual(['/', '/timeline', '/control', '/devices']);
  });

  it('puts the green Log button back in the middle once a diary is kept', async () => {
    server.diary = true;
    server.me = meOf(true, { diary: true, places: false });
    open(QUIET);

    await waitFor(() => expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Log', 'Control', 'Device']));
    expect(within(bar()).getByRole('button', { name: 'Log' })).toBeInTheDocument();
  });

  it('says Geräte once there is a second thing to list, a camera included', async () => {
    server.cameras = 1;
    open(QUIET);

    await waitFor(() => expect(within(bar()).getByRole('link', { name: 'Devices' })).toBeInTheDocument());
  });

  it('keeps Start marked on a place´s own page, and Steuerung on the pages below it', async () => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
    const router = open('/spaces/space-2');

    await waitFor(() => expect(within(bar()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page'));
    await router.navigate('/control/alarms?space=space-2');
    await waitFor(() => expect(within(bar()).getByRole('link', { name: 'Control' })).toHaveAttribute('aria-current', 'page'));
  });

  it('keeps Start marked on the task list and on a grow, which a cockpit´s grow block opens', async () => {
    server.diary = true;
    server.me = meOf(true, { diary: true, places: false });
    const router = open('/tasks');

    await waitFor(() => expect(within(bar()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page'));
    await router.navigate('/grows/grow-1');
    await waitFor(() => expect(within(bar()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page'));
  });

  it('leads back from the task list to the place it was opened from, which is Start with one place', async () => {
    server.diary = true;
    server.me = meOf(true, { diary: true, places: false });
    open('/tasks');

    const title = await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    expect(within(title.closest('header')!).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('leads back from the task list to the place last looked at, where there are several', async () => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
    server.diary = true;
    server.me = meOf(true, { diary: true, places: true });
    localStorage.setItem('terp.place', 'space-2');
    open('/tasks');

    expect(await screen.findByRole('link', { name: 'Back to Tent 2' })).toHaveAttribute('href', '/spaces/space-2');
  });

  it('draws the shape this account had last time before its answers are in, rather than jumping by a tab', async () => {
    localStorage.setItem('terp.shape.user-1', JSON.stringify({ diary: true, places: 1, devices: 3 }));
    server.diary = true;
    server.me = meOf(true, { diary: true, places: false });
    open(QUIET);

    expect([...bar().children].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Log', 'Control', 'Devices']);
  });
});

describe('the addresses a place had while it had five tabs', () => {
  beforeEach(() => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
  });

  it.each([
    ['/spaces/space-1/overview', '/spaces/space-1'],
    ['/spaces/space-1/timeline', '/timeline?space=space-1'],
    ['/spaces/space-1/control', '/control?space=space-1'],
    ['/spaces/space-1/control/targets', '/control/targets?space=space-1'],
    ['/spaces/space-1/control/alarms?rule=rule-1', '/control/alarms?space=space-1&rule=rule-1'],
    ['/spaces/space-1/devices', '/devices?space=space-1'],
    ['/spaces/space-1/members', '/spaces/space-1/members'],
  ])('sends %s on to %s', async (from, to) => {
    const router = open(from);

    await waitFor(() => expect(where(router)).toBe(to));
  });

  it('opens the place a link names on Steuerung, under a title that says which', async () => {
    open('/spaces/space-2/control/alarms?rule=rule-1');

    expect(await screen.findByRole('combobox', { name: 'Switch place' })).toHaveValue('space-2');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Control');
  });

  it('hands an only place´s own address to Start, which is that place', async () => {
    server.places = [['space-1', 'Fridge 1']];
    const router = open('/spaces/space-1/overview');

    await waitFor(() => expect(where(router)).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Fridge 1' })).toBeInTheDocument();
  });
});

describe('a place´s page', () => {
  it('has no tabs of its own, and the way back to the cards where there are several', async () => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
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

describe('Verlauf and Steuerung', () => {
  it('name the only place without offering to switch it', async () => {
    open('/control');

    const title = await screen.findByRole('heading', { level: 1, name: /Control/ });
    await waitFor(() => expect(title).toHaveTextContent('Fridge 1'));
    expect(screen.queryByRole('combobox', { name: 'Switch place' })).not.toBeInTheDocument();
  });

  it('switch places in the title, and the other tab follows the place last looked at', async () => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
    const router = open('/control');

    const picker = await screen.findByRole('combobox', { name: 'Switch place' });
    expect(picker).toHaveValue('space-1');
    fireEvent.change(picker, { target: { value: 'space-2' } });
    await waitFor(() => expect(where(router)).toBe('/control?space=space-2'));

    fireEvent.click(within(bar()).getByRole('link', { name: 'Timeline' }));
    await waitFor(() => expect(where(router)).toBe('/timeline'));
    expect(await screen.findByRole('combobox', { name: 'Switch place' })).toHaveValue('space-2');
  });

  it('open the Log sheet on the place they show', () => {
    expect(openingOf('/control/alarms', '?space=space-2', { current: 'space-1' })).toEqual({ spaceId: 'space-2', underneath: true });
    expect(openingOf('/timeline', '', { current: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/', '', { only: 'space-1' })).toEqual({ spaceId: 'space-1', underneath: true });
    expect(openingOf('/', '', {})).toEqual({});
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

  it('says once that a second place turned Start into cards and put a switcher on the tabs', async () => {
    server.places = [
      ['space-1', 'Fridge 1'],
      ['space-2', 'Tent 2'],
    ];
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('There are 2 places now');
    expect(patches()[0].body).toMatchObject({ preferences: { layoutSeen: { diary: false, places: true } } });

    fireEvent.click(within(notice).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status', { name: 'What changed' })).not.toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });

  it('says once that the diary brought the Log button, and where it is turned off', async () => {
    server.diary = true;
    server.me = meOf(true, { diary: false, places: false });
    open(QUIET);

    const notice = await screen.findByRole('status', { name: 'What changed' });
    expect(notice).toHaveTextContent('The grow diary is on.');
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
    expect(patches()).toHaveLength(0);
  });
});

describe('the place menu', () => {
  it('renames the place under the name every screen calls it by', async () => {
    open('/');

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
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

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    expect(await screen.findByRole('link', { name: 'Invite members' })).toHaveAttribute('href', '/spaces/space-1/members');
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Choose a climate preset/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Start a grow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Maintenance/ })).not.toBeInTheDocument();
  });
});
