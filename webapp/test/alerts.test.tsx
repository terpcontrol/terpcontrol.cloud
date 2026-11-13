import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRule, Alert, Device, DeviceFirmware, HomeSpaceCard, Me, OpenAlert, Problem, Task } from '@fg2/shared-types/v1';
import { Rail } from '@/app/shell/Rail';
import { TopBar } from '@/app/shell/TopBar';
import { LogProvider } from '@/log/LogProvider';
import { Alerts } from '@/screens/Alerts';
import { crossedBound, worstFirst } from '@/screens/alerts/inbox';
import { alertLabel } from '@/ui/units';
import { deviceWith } from './fixtures';
import { drawAt, json, reading } from './harness';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/**
 * The inbox behind the bell is the alarm engine's own record drawn as it came,
 * so what is checked here is the reading of it - what is open and what is
 * over, what a rule lets the card say - and what a tap sends, byte for byte:
 * a silence is an hour on the rule's own route, and a mute is the whole
 * notification object handed back with one field changed, because the server
 * replaces rather than merges it.
 *
 * Every read here goes through the real client to a fetch that answers per
 * route, so the test sees exactly the request the server would.
 */

const state = vi.hoisted(() => ({
  who: 'you' as 'you' | 'demo',
  /** The most the reader may do in the tent every alert here happened in. */
  youMay: 'own' as 'own' | 'manage' | 'log' | 'view',
  refuse: null as { method: string; path: string; problem: Problem } | null,
  /** A route answered only once the test lets it, for looking at a page while one of its reads is still out. */
  hold: null as { path: string; until: Promise<void> } | null,
}));

vi.mock('@/api/session', async importOriginal => {
  const { ON_THE_DEMO, SIGNED_IN } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    useSession: () => (state.who === 'demo' ? ON_THE_DEMO : SIGNED_IN),
    session: { validToken: async () => 'token', refresh: async () => null, snapshot: () => SIGNED_IN, mediaToken: () => null },
  };
});

/*
 * The suite runs at midday where the account is, whatever the wall clock says.
 * A card names the day beside the hour for an instant that is not today's, and
 * these cases are written as "two hours ago": run between midnight and two in
 * the morning, that is yesterday, the card rightly says so, and the case fails
 * for the time of night rather than for anything the inbox did. Only Date is
 * faked, so the app's clock and this one agree and every timer still runs.
 */
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(DateTime.now().setZone('Europe/Berlin').set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate());
afterAll(() => vi.useRealTimers());

const NOW = DateTime.now();
const iso = (at: DateTime) => at.toISO()!;
/** The zone the account below keeps, which is the one every clock time on these cards is drawn in whatever zone the suite runs in. */
const ACCOUNT_ZONE = 'Europe/Berlin';
const clock = (at: DateTime) => at.setZone(ACCOUNT_ZONE).toFormat('HH:mm');
/** How a card dates the alert every case here starts from. */
const since = `since ${clock(NOW.minus({ hours: 2, minutes: 20 }))}`;

const alert = (over: Partial<Alert>): Alert => ({
  id: 'alert-1',
  createdAt: iso(NOW.minus({ hours: 2, minutes: 20 })),
  ruleId: 'rule-1',
  deviceId: 'device-1',
  cameraId: null,
  spaceId: 'space-1',
  kind: 'threshold',
  severity: 'critical',
  startedAt: iso(NOW.minus({ hours: 2, minutes: 20 })),
  resolvedAt: null,
  rested: false,
  value: 68,
  extremeValue: 71,
  watched: null,
  ...over,
});

const rule = (over: Partial<AlarmRule> = {}): AlarmRule => ({
  id: 'rule-1',
  createdAt: iso(NOW.minus({ days: 30 })),
  deviceId: 'device-1',
  name: 'Humidity high',
  watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null },
  forSeconds: 600,
  severity: 'critical',
  origin: 'human',
  presetId: null,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: 1800,
  delivery: { mode: 'routing', custom: null },
  silencedUntil: null,
  state: { triggered: true, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: 71, lastSampleAt: null },
  ...over,
});

const me: Me = {
  pushSubscribed: false,
  id: 'user-1',
  createdAt: iso(NOW.minus({ days: 90 })),
  email: 'you@example.com',
  isAdmin: false,
  isActive: true,
  handle: 'you',
  bio: null,
  avatarMediaId: null,
  publicProfile: false,
  privacy: { showGrowsOnProfile: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: ACCOUNT_ZONE },
  retention: { entriesDays: null, mediaDays: null },
  notifications: {
    channels: { email: true, push: false, telegram: null, webhook: null },
    routing: { alerts: ['email'], warnings: ['email'], tasks: [], plan: [], weekly_timelapse: [] },
    quietHours: null,
    mutedUntil: null,
  },
  layers: { diary: false },
} as unknown as Me;

const keepsDiary = { ...me, layers: { diary: true } } as Me;

const deviceRow = (over: Parameters<typeof deviceWith>[0] = {}): Device =>
  deviceWith({ name: 'Blue Dream tent', ...over, state: { lastSeenAt: iso(NOW.minus({ minutes: 1 })), ...over.state } });

/** A place as the home lists it, as far as what is due reads it. */
const card = (over: Partial<HomeSpaceCard> = {}): HomeSpaceCard =>
  ({
    spaceId: 'space-1',
    name: 'Flower room B',
    kind: 'tent',
    roomId: null,
    deviceIds: ['device-1'],
    climates: [],
    values: [],
    setpoints: [],
    trend: null,
    grow: null,
    entries: [],
    events: [],
    latestStill: null,
    dueTasks: [],
    openAlerts: [],
    ...over,
  }) as HomeSpaceCard;

/** What the stubbed server holds, and every request it was sent. */
const server = {
  alerts: [] as Alert[],
  /** The page behind the cursor: an empty one is a list with no `nextCursor`. */
  older: [] as Alert[],
  rules: [] as AlarmRule[],
  devices: [deviceRow()],
  cameras: [{ id: 'cam-2', name: 'Cam 2' }] as Record<string, unknown>[],
  /** The builds a device is offered, by its id. */
  builds: {} as Record<string, DeviceFirmware[]>,
  me,
  home: [] as HomeSpaceCard[],
  tasks: [] as Task[],
  sent: [] as { method: string; path: string; body: unknown }[],
};

const answer = (method: string, path: string, body: unknown): Response => {
  if (state.refuse && state.refuse.method === method && path.startsWith(state.refuse.path))
    return json(state.refuse.problem, state.refuse.problem.status);
  if (method === 'GET' && path.startsWith('/v1/alerts')) {
    // A demo session is answered an empty page whatever its tents hold, which
    // is the one thing this route does differently for it.
    if (state.who === 'demo') return json({ items: [], nextCursor: null });
    const query = new URL(path, 'http://x').searchParams;
    // What is open and what is over are asked for apart, and the route answers
    // each half on its own as the server does.
    const half = (list: Alert[]) => list.filter(one => (query.get('open') === 'true' ? one.resolvedAt === null : one.resolvedAt !== null));
    if (query.get('cursor')) return json({ items: half(server.older), nextCursor: null });

    return json({ items: half(server.alerts), nextCursor: server.older.length ? 'cursor-1' : null });
  }
  // What a card offers - silencing the rule - is `manage` where the alert happened, so the space list carries the standing.
  if (method === 'GET' && path === '/v1/spaces')
    return json({ items: [spaceWhere(state.youMay, { id: 'space-1', name: 'Flower room B' })], nextCursor: null });
  if (method === 'GET' && path === '/v1/devices') return json({ items: server.devices, nextCursor: null });
  const builds = /^\/v1\/devices\/([^/]+)\/firmwares$/.exec(path);
  if (method === 'GET' && builds) return json({ items: server.builds[builds[1]] ?? [], nextCursor: null });
  if (method === 'GET' && path === '/v1/home')
    return json({ spaces: server.home, followedGrows: [], people: [], layers: state.who === 'demo' ? { diary: true } : server.me.layers });
  if (method === 'GET' && path === '/v1/cameras') return json({ items: server.cameras, nextCursor: null });
  const rules = /^\/v1\/devices\/([^/]+)\/alarm-rules/.exec(path);
  if (method === 'GET' && rules) return json({ items: server.rules.filter(one => one.deviceId === rules[1]), nextCursor: null });
  if (method === 'GET' && path === '/v1/me') return json(server.me);
  if (method === 'GET' && path.startsWith('/v1/tasks')) return json({ items: server.tasks, nextCursor: null });
  if (method === 'PUT' && path.startsWith('/v1/alarm-rules/')) return json(server.rules[0]);
  if (method === 'DELETE' && path.startsWith('/v1/alarm-rules/')) return json(server.rules[0]);
  if (method === 'DELETE' && path.startsWith('/v1/alerts/')) {
    server.alerts = server.alerts.filter(one => `/v1/alerts/${one.id}` !== path);
    return new Response(null, { status: 204 });
  }
  if (method === 'PATCH' && path === '/v1/me') return json({ ...server.me, ...(body as Partial<Me>) });
  if (method === 'POST' && /^\/v1\/tasks\/[^/]+\/completions$/.test(path)) return json({ id: 'entry-1' });
  if (method === 'POST' && path.startsWith('/v1/devices/device-1/commands')) return json({ publishedAt: iso(NOW), deviceOnline: true });
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: `No route for ${method} ${path}`, errors: [] }, 404);
};

const draw = (ui: React.ReactNode = <Alerts />) => drawAt(<LogProvider>{ui}</LogProvider>);

const sentTo = (method: string, path: string) => server.sent.filter(one => one.method === method && one.path.startsWith(path));

/** Reads of one route exactly, for counting them: `/v1/devices` is not `/v1/devices/device-1/alarm-rules`. */
const readsOf = (path: string) => server.sent.filter(one => one.method === 'GET' && one.path.split('?')[0] === path);

beforeAll(() => translate());

beforeEach(() => {
  state.who = 'you';
  state.youMay = 'own';
  state.refuse = null;
  state.hold = null;
  server.alerts = [];
  server.older = [];
  server.rules = [];
  server.devices = [deviceRow()];
  server.cameras = [{ id: 'cam-2', name: 'Cam 2' }];
  server.builds = {};
  server.me = me;
  server.home = [];
  server.tasks = [];
  server.sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      server.sent.push({ method, path: url.pathname + url.search, body });
      if (state.hold && url.pathname.startsWith(state.hold.path)) await state.hold.until;

      return answer(method, url.pathname + url.search, body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The cards under "Open", in the order they are drawn. */
const openCards = () => within(screen.getByRole('region', { name: 'Open' })).getAllByRole('listitem');

/** The rows under "Over", each as its title and the line under it. */
const overRows = () =>
  within(screen.getByRole('region', { name: 'Over' }))
    .getAllByRole('button')
    .map(row => [...row.querySelector('span')!.childNodes].map(node => node.textContent?.replace(/\u00a0/g, ' ')));

/** Opens what a row under "Over" holds, and hands back its sheet. */
const openRow = async (name: string | RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name }));

  return screen.getByRole('dialog');
};

describe('the inbox', () => {
  it('says nothing is open when nothing is, and draws neither list', async () => {
    draw();

    expect(await screen.findByText('Nothing is open right now.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up notifications ›' })).toHaveAttribute('href', '/me/notifications');
  });

  it('says instead that nothing is watching, where no hardware can raise anything', async () => {
    server.devices = [];
    server.cameras = [];
    draw();

    expect(
      await screen.findByText('Alarms land here once a device measures or a cam films. What is due in the diary is under Tasks.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nothing is open right now.')).not.toBeInTheDocument();
    // Nothing here can raise an alarm, so there is nothing to mute.
    expect(screen.queryByRole('button', { name: 'Mute 1 h' })).not.toBeInTheDocument();
  });

  it('draws what is open as cards and what is over as rows, each saying how long ago it ended', async () => {
    server.alerts = [
      alert({ id: 'open' }),
      alert({
        id: 'offline',
        kind: 'offline',
        ruleId: null,
        startedAt: iso(NOW.minus({ hours: 3, minutes: 6 })),
        resolvedAt: iso(NOW.minus({ hours: 3 })),
        value: null,
        severity: 'warning',
      }),
      alert({ id: 'yesterday', startedAt: iso(NOW.minus({ hours: 26 })), resolvedAt: iso(NOW.minus({ hours: 25, minutes: 20 })) }),
      alert({ id: 'older', startedAt: iso(NOW.minus({ days: 5, hours: 1 })), resolvedAt: iso(NOW.minus({ days: 5 })), severity: 'info' }),
    ];
    server.rules = [rule()];
    draw();

    await screen.findByRole('heading', { level: 2, name: 'Over' });
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Open', 'Over']);
    expect(openCards()).toHaveLength(1);
    // A night the tent ran hot is still worth reading in the morning: nothing is dropped for being old.
    expect(overRows()).toEqual([
      ['Blue Dream tent offline for 6 min', '3 h ago'],
      ['Humidity too high for 40 min', '1 d ago'],
      ['Humidity too high for 1 h', '5 d ago'],
    ]);
  });

  it('says what happened, since when, where and how far out, then which rule raised it and how it will go on', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText('Humidity too high')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 68 % · above 60 %`))).toBeInTheDocument();
    expect(screen.getByText(reading('Humidity high · critical · repeats every 30 min until resolved'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/control/alarms?space=space-1&rule=rule-1');
  });

  /** A place may hold a second climate, so the curves an alert opens are those of the device it came from. */
  it('opens the timeline on what the alert watched, when it began and on its device', async () => {
    const began = NOW.minus({ minutes: 50 });
    server.devices = [deviceRow(), deviceRow({ id: 'device-2', name: 'Cutting fridge' })];
    server.alerts = [alert({}), alert({ id: 'second', deviceId: 'device-2', ruleId: 'rule-2', startedAt: iso(began), value: null })];
    server.rules = [rule(), rule({ id: 'rule-2', deviceId: 'device-2', watch: { kind: 'output_running', output: 'dehumidifier' } })];
    draw();

    await screen.findByText('Dehumidifier runs without a pause');
    expect(screen.getAllByRole('link', { name: 'Open timeline' }).map(link => link.getAttribute('href'))).toEqual([
      `/timeline?space=space-1&device=device-2&focus=dehumidifier&at=${encodeURIComponent(iso(began))}`,
      `/timeline?space=space-1&device=device-1&focus=humidity&at=${encodeURIComponent(iso(NOW.minus({ hours: 2, minutes: 20 })))}`,
    ]);
  });

  it('names the severity to anybody who cannot see the coloured edge, and keeps the figure and its unit in one piece', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    const named = await screen.findByLabelText('critical · Humidity too high');
    // Neither the unit nor the bound may be wrapped away from the number it belongs to.
    expect(named.textContent).toContain('68\u00a0% · above\u00a060\u00a0%');
  });

  it('names the output for a rule that watches one, leaves an empty span off, and says only the kind for an episode that kept no copy', async () => {
    server.alerts = [
      alert({ id: 'running', ruleId: 'rule-2', value: null }),
      alert({ id: 'instant', ruleId: 'rule-3', value: null }),
      alert({ id: 'orphan', ruleId: 'rule-gone' }),
    ];
    server.rules = [
      rule({ id: 'rule-2', watch: { kind: 'output_running', output: 'dehumidifier' }, forSeconds: 7200, repeatSeconds: 0 }),
      rule({ id: 'rule-3', watch: { kind: 'output_running', output: 'heater' }, forSeconds: 0 }),
    ];
    draw();

    const running = await screen.findByLabelText('critical · Dehumidifier runs without a pause');
    expect(within(running).getByText(reading(`${since} · Flower room B · longer than 2 h`))).toBeInTheDocument();
    expect(within(running).getByText(reading('Humidity high · critical · announced once'))).toBeInTheDocument();
    // A rule that trips the moment the output starts has no span worth drawing.
    const instant = screen.getByLabelText('critical · Heater runs without a pause');
    expect(within(instant).getByText(reading(`${since} · Flower room B`))).toBeInTheDocument();
    expect(screen.queryByText(/0 s/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('critical · alarm')).getByText(reading(`${since} · Flower room B · 68`))).toBeInTheDocument();
  });

  /**
   * An alert outlives the rule that raised it, which is right - it is the record
   * of a night that really happened - but it left the card with a ruleId it
   * could not look anything up by, so a deleted rule's history read "alarm" and
   * a bare unitless figure. The episode carries its own copy of what the rule
   * was called and watched from the moment it opens, and what is said of it
   * reads that where there is no rule left to read: the metric, the way it left
   * its band, and the name on the line below, exactly as while the rule stood.
   */
  it('says what an episode watched after its rule has been deleted, from the copy the alert kept', async () => {
    server.alerts = [
      alert({
        id: 'remembered',
        ruleId: 'rule-gone',
        resolvedAt: iso(NOW.minus({ hours: 1 })),
        watched: { name: 'Too humid', watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null } },
      }),
    ];
    server.rules = [];
    draw();

    const sheet = await openRow(/^Humidity too high for 1 h/);
    expect(within(sheet).getByText(reading(`Too humid · critical · until ${clock(NOW.minus({ hours: 1 }))}`))).toBeInTheDocument();
    expect(within(sheet).queryByText(/alarm/)).not.toBeInTheDocument();
  });

  it('keeps the grade the episode was raised at, says what its rule says now, and promises only what that grade gets', async () => {
    server.alerts = [alert({ severity: 'warning' })];
    server.rules = [rule({ severity: 'critical' })];
    draw();

    expect(
      await screen.findByText(reading('Humidity high · warning · the rule now says critical · repeats every 30 min until resolved')),
    ).toBeInTheDocument();
    // The coloured edge is the same one decision, not the rule's.
    expect(screen.getByRole('listitem')).toHaveAttribute('data-severity', 'warning');
  });

  it('announces an info alarm nowhere, and says of a routed one that it reached nobody, with the way to change that', async () => {
    server.me = {
      ...me,
      notifications: { ...me.notifications, routing: { ...me.notifications.routing, warnings: ['push'] } },
    } as unknown as Me;
    server.alerts = [
      alert({ id: 'quiet', ruleId: 'rule-2', severity: 'info', startedAt: iso(NOW.minus({ minutes: 10 })) }),
      alert({ id: 'warn', severity: 'warning', startedAt: iso(NOW.minus({ minutes: 20 })) }),
    ];
    server.rules = [rule({ severity: 'warning' }), rule({ id: 'rule-2', name: 'Leaf cool', severity: 'info', repeatSeconds: 0 })];
    draw();

    expect(await screen.findByText(reading('Leaf cool · info · not announced'))).toBeInTheDocument();
    // A row of the grid that names only a channel this account cannot be
    // reached on is a rule nobody would hear.
    const [unheard, quiet] = openCards();
    expect(within(unheard).getByText(reading('Humidity high · warning · did not reach you'))).toBeInTheDocument();
    // It is the account's own settings that decide it, so the card leads there - and only that card.
    expect(within(unheard).getByRole('link', { name: 'Set up notifications' })).toHaveAttribute('href', '/me/notifications');
    expect(within(quiet).queryByRole('link', { name: 'Set up notifications' })).not.toBeInTheDocument();
    expect(screen.queryByText(/announced once/)).not.toBeInTheDocument();
  });

  /**
   * Two alerts in one undeliverable state used to read as two different states:
   * the rule-backed one said nobody was listening and the camera the health
   * loop raised said nothing, which is the shape of a card that did reach
   * somebody.
   */
  it('says of a camera no rule raised that nobody heard it either', async () => {
    server.me = {
      ...me,
      notifications: { ...me.notifications, routing: { ...me.notifications.routing, alerts: ['email'], warnings: ['push'] } },
    } as unknown as Me;
    server.alerts = [
      alert({ id: 'offline', kind: 'offline', severity: 'critical', startedAt: iso(NOW.minus({ minutes: 30 })) }),
      alert({
        id: 'cam',
        kind: 'camera_stale',
        ruleId: null,
        deviceId: null,
        spaceId: null,
        cameraId: 'cam-2',
        severity: 'warning',
        startedAt: iso(NOW.minus({ minutes: 20 })),
        value: 900,
        extremeValue: 900,
      }),
    ];
    server.rules = [rule({ name: 'Device offline' })];
    draw();

    expect(await screen.findByText(reading('warning · did not reach you'))).toBeInTheDocument();
    // The account can be reached for a critical alarm, so the card beside it
    // says what it will go on doing rather than that it reached nobody.
    expect(screen.getByText(reading('Device offline · critical · repeats every 30 min until resolved'))).toBeInTheDocument();
  });

  it('says a camera nobody could have missed is announced once, because the health loop never repeats one', async () => {
    server.alerts = [
      alert({
        id: 'cam',
        kind: 'camera_stale',
        ruleId: null,
        deviceId: null,
        spaceId: null,
        cameraId: 'cam-2',
        severity: 'warning',
        value: 900,
        extremeValue: 900,
      }),
    ];
    draw();

    expect(await screen.findByText(reading('warning · announced once'))).toBeInTheDocument();
  });

  /** Not having a rule is one thing; naming one the page has not got is another, and only the first is a delivery this screen can read. */
  it('stays silent about delivery where the alert names a rule the list could not answer for', async () => {
    server.alerts = [alert({ id: 'orphan', ruleId: 'rule-gone' })];
    server.rules = [];
    draw();

    const orphan = await screen.findByLabelText('critical · alarm');
    expect(within(orphan).getByText(reading('critical'))).toBeInTheDocument();
    expect(screen.queryByText(/announced once|did not reach you|not announced|repeats every/)).not.toBeInTheDocument();
  });

  /** Owner's decision G2: an episode the stage's "too humid" stopped watching in germination did not get better, and is not said to have. */
  it('says an alert that went quiet in germination rests there, rather than that it is back in range', async () => {
    server.alerts = [alert({ id: 'humid', severity: 'warning', resolvedAt: iso(NOW.minus({ minutes: 5 })), rested: true })];
    draw();

    const sheet = await openRow(/5 min ago$/);
    expect(
      within(sheet).getByText(reading(`${clock(NOW.minus({ hours: 2, minutes: 20 }))} · Flower room B · rests in germination · not resolved`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/back in range/)).not.toBeInTheDocument();
  });

  it('promises nothing about a ruleless alert that is over', async () => {
    server.alerts = [
      alert({
        id: 'cam',
        kind: 'camera_stale',
        ruleId: null,
        deviceId: null,
        spaceId: null,
        cameraId: 'cam-2',
        severity: 'warning',
        resolvedAt: iso(NOW.minus({ minutes: 5 })),
        value: 900,
        extremeValue: 900,
      }),
    ];
    draw();

    const sheet = await openRow(/^Cam 2 without a picture for/);
    expect(within(sheet).getByText(reading(`warning · until ${clock(NOW.minus({ minutes: 5 }))}`))).toBeInTheDocument();
    expect(within(sheet).getByText(/delivers pictures again$/)).toBeInTheDocument();
    expect(screen.queryByText(/announced once|did not reach you|not announced/)).not.toBeInTheDocument();
  });

  it('puts the worst first and lets the clock decide only between equals', async () => {
    server.alerts = [
      alert({ id: 'warn', severity: 'warning', startedAt: iso(NOW.minus({ minutes: 5 })) }),
      alert({ id: 'info', severity: 'info', startedAt: iso(NOW.minus({ minutes: 1 })) }),
      alert({ id: 'old-critical', severity: 'critical', startedAt: iso(NOW.minus({ hours: 4 })) }),
      alert({ id: 'new-critical', severity: 'critical', startedAt: iso(NOW.minus({ hours: 1 })) }),
    ];
    server.rules = [rule()];
    draw();

    await screen.findByRole('heading', { level: 2, name: 'Open' });
    const cards = openCards();
    expect(cards.map(one => one.getAttribute('data-severity'))).toEqual(['critical', 'critical', 'warning', 'info']);
    expect(within(cards[0]).getByText(reading(new RegExp(`^since ${clock(NOW.minus({ hours: 1 }))} · `)))).toBeInTheDocument();
  });

  it('names the device as well as the tent where the tent holds more than one', async () => {
    server.devices = [deviceRow(), deviceRow({ id: 'device-2', name: 'Cutting fridge' })];
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(reading(`${since} · Flower room B · Blue Dream tent · 68 % · above 60 %`))).toBeInTheDocument();
  });

  it('draws the cards as soon as the alerts are there, waiting for no name to do it', async () => {
    let arrive = () => {};
    state.hold = {
      path: '/v1/spaces',
      until: new Promise<void>(resolve => {
        arrive = resolve;
      }),
    };
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(reading(`${since} · 68 % · above 60 %`))).toBeInTheDocument();
    arrive();
    expect(await screen.findByText(reading(`${since} · Flower room B · 68 % · above 60 %`))).toBeInTheDocument();
  });

  it('falls back to the id when a name cannot be read, and says that it could not', async () => {
    state.refuse = {
      method: 'GET',
      path: '/v1/spaces',
      problem: { status: 503, code: 'unavailable', title: 'Unavailable', detail: 'Try again.', errors: [] },
    };
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(reading(`${since} · space-1 · 68 % · above 60 %`))).toBeInTheDocument();
    expect(screen.getByText('Could not read the names · places, devices and cams are shown by their id')).toBeInTheDocument();
  });

  it('reads what is open once for the bell and the list together', async () => {
    server.alerts = [alert({ id: 'open' }), alert({ id: 'over', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    server.rules = [rule()];
    draw(
      <>
        <TopBar />
        <Alerts />
      </>,
    );

    expect(await screen.findByRole('link', { name: 'Alerts · 1 open' })).toBeInTheDocument();
    await waitFor(() => expect(readsOf('/v1/alerts')).toHaveLength(2));
    // One read of what is open, one of what is over, and the badge on top of
    // neither: the bell counts the list the inbox is drawing.
    expect(readsOf('/v1/alerts').filter(one => one.path.includes('open=true'))).toHaveLength(1);
    expect(readsOf('/v1/alerts').filter(one => one.path.includes('open=false'))).toHaveLength(1);
  });

  it('names a device gone quiet in the title, dates it from when it was last heard, and says what to try', async () => {
    server.alerts = [
      alert({ id: 'off', kind: 'offline', ruleId: null, severity: 'warning', value: 1500, startedAt: iso(NOW.minus({ minutes: 10 })) }),
    ];
    draw();

    // The silence is dated from the last time the device said anything rather
    // than from when the cloud noticed, and the place is not said to be the
    // device a second time.
    const quiet = await screen.findByLabelText('warning · Blue Dream tent offline');
    expect(within(quiet).getByText(reading(`since ${clock(NOW.minus({ minutes: 35 }))} · Flower room B`))).toBeInTheDocument();
    // Nothing can be sent to a device nobody hears, so the card says what to try - a tap away.
    expect(screen.queryByText(/^Power: is the adapter plugged in/)).not.toBeInTheDocument();
    fireEvent.click(within(quiet).getByRole('button', { name: 'What you can do ›' }));
    expect(within(quiet).getByText(/^Power: is the adapter plugged in/)).toBeInTheDocument();
    expect(within(quiet).getByText(/^Unplug the device, wait 10 seconds/)).toBeInTheDocument();
    expect(within(quiet).getByRole('link', { name: 'To the device' })).toHaveAttribute('href', '/devices/device-1');
    expect(within(quiet).queryByRole('button', { name: 'Silence 1 h' })).not.toBeInTheDocument();
  });

  /**
   * The one figure that answers the reader's question. A camera that had been
   * dark for 3 d 22 h when the cloud noticed used to be drawn as "no image
   * since 13:19 … resolved 13:20 · lasted 1 min", which reads as a blink: the
   * card printed the moment it was raised and threw the staleness away.
   */
  it('dates a stale camera from the last picture it took, not from when the cloud noticed', async () => {
    const dark = { days: 3, hours: 22, minutes: 15 };
    const raised = NOW.minus({ minutes: 30 });
    server.alerts = [
      alert({
        id: 'cam',
        kind: 'camera_stale',
        ruleId: null,
        deviceId: null,
        spaceId: null,
        cameraId: 'cam-2',
        severity: 'warning',
        startedAt: iso(raised),
        value: raised.diff(raised.minus(dark)).as('seconds'),
        extremeValue: raised.diff(raised.minus(dark)).as('seconds'),
      }),
    ];
    draw();

    // Four days back is not today, so the day is named beside the hour rather
    // than a bare time that reads as this morning.
    const lastStill = raised.minus(dark).setZone(ACCOUNT_ZONE).toFormat('d MMM HH:mm');
    const dark4d = await screen.findByLabelText('warning · Cam 2 without a picture');
    expect(within(dark4d).getByText(reading(`since ${lastStill}`))).toBeInTheDocument();
  });

  /**
   * The inbox printed every output level as a percent and rounded it to a whole
   * number, while the rule card wrote the same bound bare and the sheet called
   * it a fraction. A fan does run in percent, so that card was accidentally
   * right; a heater does not, and its half power read "1 %" on a series whose
   * whole range is nought to one.
   */
  it('writes a heater level as the fraction it is, decimals and all', async () => {
    server.alerts = [alert({ value: 0.5, extremeValue: 0.5 })];
    server.rules = [rule({ name: 'Heater flat out', watch: { kind: 'output_level', output: 'heater', upper: 0.4, lower: null } })];
    draw();

    expect(await screen.findByText('Heater too high')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 0.5 · above 0.4`))).toBeInTheDocument();
  });

  it('writes a fan level as the percentage it is', async () => {
    server.devices = [deviceRow({ type: 'fan', name: 'Exhaust fan' })];
    server.alerts = [alert({ value: 100, extremeValue: 100 })];
    server.rules = [rule({ name: 'Fan flat out', watch: { kind: 'output_level', output: 'fan', upper: 80, lower: null } })];
    draw();

    expect(await screen.findByText('Fan too high')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 100 % · above 80 %`))).toBeInTheDocument();
  });

  it('names the camera for a stale one and offers a look rather than a silence', async () => {
    // Raised at midday rather than a couple of hours ago, because the card
    // names the day for an instant that is not today's: run between midnight
    // and 02:20 and "two hours ago" is yesterday, and the card would rightly
    // say so while this case is about the bare hour.
    const raised = NOW.setZone(ACCOUNT_ZONE).startOf('day').plus({ hours: 12 });
    server.alerts = [
      // An alert the health loop raised without a staleness to carry, which is
      // the one case where the moment it was raised is all there is to date it by.
      alert({
        id: 'cam',
        kind: 'camera_stale',
        ruleId: null,
        deviceId: null,
        spaceId: null,
        cameraId: 'cam-2',
        severity: 'info',
        startedAt: iso(raised),
        value: null,
        extremeValue: null,
      }),
    ];
    draw();

    expect(await screen.findByText('Cam 2 without a picture')).toBeInTheDocument();
    expect(screen.getByText(reading(`since ${clock(raised)}`))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check cam' })).toHaveAttribute('href', '/cameras/cam-2');
    expect(screen.queryByRole('button', { name: 'Silence 1 h' })).not.toBeInTheDocument();
  });

  it('silences the rule for an hour on its own route', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Silence 1 h' }));

    await waitFor(() => expect(sentTo('PUT', '/v1/alarm-rules/rule-1/silence')).toHaveLength(1));
    expect(sentTo('PUT', '/v1/alarm-rules/rule-1/silence')[0].body).toEqual({ forSeconds: 3600 });
  });

  it('says what silencing does once, beside the first Silence the page offers', async () => {
    server.alerts = [alert({ id: 'cam', kind: 'camera_stale', ruleId: null, deviceId: null, cameraId: 'cam-2' }), alert({}), alert({ id: 'second' })];
    server.rules = [rule()];
    draw();

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Silence 1 h' })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'About Silence 1 h' })).toHaveLength(1);
    // The camera's card leads the list and offers no silence, so the help stands on the card after it.
    expect(within(openCards()[1]).getByRole('button', { name: 'About Silence 1 h' })).toHaveAccessibleDescription(
      /^Stops this one rule telling anybody/,
    );
  });

  it('offers the way out of a silence, and says until when it holds', async () => {
    server.alerts = [alert({})];
    server.rules = [rule({ silencedUntil: iso(NOW.plus({ minutes: 40 })) })];
    draw();

    expect(await screen.findByText(reading(new RegExp(` · silenced for everyone until ${clock(NOW.plus({ minutes: 40 }))}$`)))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unsilence' }));

    await waitFor(() => expect(sentTo('DELETE', '/v1/alarm-rules/rule-1/silence')).toHaveLength(1));
  });

  /** Maintenance is the place's, started on Start and with the device under Steuerung: a card says that one stands and starts none. */
  it('says that the device is in maintenance, and offers neither a window nor the end of one', async () => {
    server.devices = [deviceRow({ state: { maintenanceUntil: iso(NOW.plus({ minutes: 8 })) } })];
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(
      await screen.findByText(new RegExp(`device in maintenance, nothing raised until ${clock(NOW.plus({ minutes: 18 }))}`)),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Silence 1 h' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /maintenance/i })).not.toBeInTheDocument();
    expect(sentTo('POST', '/v1/devices/device-1/commands')).toHaveLength(0);
  });

  /**
   * The window and the settling end at different instants, and for the ten
   * minutes between them the hardware is running again while the alarms are
   * still held. The card said "device in maintenance" for all of it - which is
   * the device's state, said wrongly, in the very minutes a grower is most
   * likely to think the watch is back on.
   */
  it('says the device is out of maintenance while only the settling still holds the alarms', async () => {
    server.devices = [deviceRow({ state: { maintenanceUntil: iso(NOW.minus({ minutes: 2 })) } })];
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(
      await screen.findByText(new RegExp(`device out of maintenance, nothing raised until ${clock(NOW.plus({ minutes: 8 }))}`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/device in maintenance/)).not.toBeInTheDocument();
  });

  it('shows what the server said when it refused, under the card', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    state.refuse = {
      method: 'PUT',
      path: '/v1/alarm-rules/rule-1/silence',
      problem: { status: 409, code: 'rule_disabled', title: 'Conflict', detail: 'This rule is switched off.', errors: [] },
    };
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Silence 1 h' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This rule is switched off.');
  });

  it('opens the whole of an episode that is over from its row: when, where, the rule, and its curves', async () => {
    const began = NOW.minus({ hours: 2, minutes: 20 });
    server.alerts = [alert({ id: 'over-1', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    server.rules = [rule()];
    draw();

    const sheet = await openRow(/^Humidity too high for 1 h/);
    expect(sheet).toHaveAccessibleName('Humidity too high for 1 h');
    expect(within(sheet).getByText(reading(`${clock(began)} · Flower room B · back in range since then`))).toBeInTheDocument();
    expect(within(sheet).getByText(reading(`Humidity high · critical · until ${clock(NOW.minus({ hours: 1 }))}`))).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Open timeline' })).toHaveAttribute(
      'href',
      `/timeline?space=space-1&device=device-1&focus=humidity&at=${encodeURIComponent(iso(began))}`,
    );
    // What is over can no longer be silenced, and its rule is edited where the rule is.
    expect(within(sheet).queryByRole('button', { name: 'Silence 1 h' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: 'Edit rule' })).not.toBeInTheDocument();
  });

  it('deletes an episode that is over once asked and says so, and offers no delete on one still open', async () => {
    server.alerts = [alert({ id: 'open-1' }), alert({ id: 'over-1', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    server.rules = [rule()];
    draw();

    const sheet = await openRow(/^Humidity too high for 1 h/);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    expect(within(sheet).getByText(/deleted for everyone you share the place with/)).toBeInTheDocument();
    expect(sentTo('DELETE', '/v1/alerts/')).toHaveLength(0);

    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => expect(sentTo('DELETE', '/v1/alerts/')).toHaveLength(1));
    expect(sentTo('DELETE', '/v1/alerts/')[0].path).toBe('/v1/alerts/over-1');
    expect(await screen.findByText('Alert deleted')).toBeInTheDocument();
    // The sheet goes with what it was about, and so does the row.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Over' })).not.toBeInTheDocument());
    expect(openCards()).toHaveLength(1);
  });

  it('keeps what was asked when the reader steps back from deleting', async () => {
    server.alerts = [alert({ id: 'over-1', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    server.rules = [rule()];
    draw();

    const sheet = await openRow(/^Humidity too high for 1 h/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));

    expect(within(sheet).queryByText(/deleted for everyone/)).not.toBeInTheDocument();
    expect(sentTo('DELETE', '/v1/alerts/')).toHaveLength(0);
    expect(screen.queryByText('Alert deleted')).not.toBeInTheDocument();
  });

  it('mutes everything for an hour by handing the whole notification object back, and says until when', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Mute 1 h' }));

    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(1));
    const { notifications } = sentTo('PATCH', '/v1/me')[0].body as Me;
    expect(notifications).toEqual({ ...me.notifications, mutedUntil: expect.any(String) });
    const until = DateTime.fromISO(notifications.mutedUntil!);
    expect(Math.abs(until.diff(DateTime.now(), 'minutes').minutes - 60)).toBeLessThan(1);
    expect(notifications.mutedUntil).toMatch(/Z$/);

    expect(await screen.findByText(`your channels muted until ${clock(until)}`)).toBeInTheDocument();
    expect(screen.getByText(`Everything muted until ${clock(until)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(2));
    expect((sentTo('PATCH', '/v1/me')[1].body as Me).notifications.mutedUntil).toBeNull();
    expect(await screen.findByText('Unmuted')).toBeInTheDocument();
    expect(screen.queryByText(/^your channels muted until/)).not.toBeInTheDocument();
  });

  it('takes a mute back from the toast that answered it', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Mute 1 h' }));
    await screen.findByText(/^Everything muted until/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(2));
    expect((sentTo('PATCH', '/v1/me')[1].body as Me).notifications.mutedUntil).toBeNull();
    expect(await screen.findByRole('button', { name: 'Mute 1 h' })).toBeInTheDocument();
  });

  it('says beside the mute what it does and whom it spares', async () => {
    draw();

    expect(await screen.findByRole('button', { name: 'About Mute all' })).toHaveAccessibleDescription(/^For an hour nothing is sent to you/);
  });

  it('tells the demo where the alarms are instead of calling its empty page a quiet tent, and offers it nothing that writes', async () => {
    state.who = 'demo';
    // Whatever the demo's tents hold, the route answers a demo session an empty page.
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText('The demo has no inbox; open a place to see its alarms.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is open right now.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    // The demo has no channels to set up.
    expect(screen.queryByRole('link', { name: 'Set up notifications ›' })).not.toBeInTheDocument();
  });

  /** The route answers a demo session `403 no_account`, so the screen that knows it would be refused does not ask. */
  it('asks the demo session nothing about an account', async () => {
    state.who = 'demo';
    draw();

    expect(await screen.findByText('The demo has no inbox; open a place to see its alarms.')).toBeInTheDocument();
    expect(readsOf('/v1/me')).toHaveLength(0);
  });

  it('still reads the account for somebody who has one, and reads it once for the list and the mute together', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByRole('button', { name: 'Mute 1 h' })).toBeInTheDocument();
    expect(readsOf('/v1/me')).toHaveLength(1);
  });

  it('follows the cursor it was given when the reader asks for what came before, without taking back what is on screen', async () => {
    server.alerts = [alert({ id: 'open' }), alert({ id: 'over', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    server.older = [
      alert({
        id: 'older',
        deviceId: 'device-2',
        ruleId: 'rule-9',
        startedAt: iso(NOW.minus({ days: 4, hours: 1 })),
        resolvedAt: iso(NOW.minus({ days: 4 })),
      }),
    ];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Earlier' }));

    await waitFor(() => expect(overRows()).toHaveLength(2));
    expect(overRows()[1][1]).toBe('4 d ago');
    // The rules of a device the older page brings with it must not blank the page.
    expect(screen.getByText(reading(`${since} · Flower room B · 68 % · above 60 %`))).toBeInTheDocument();
    expect(sentTo('GET', '/v1/alerts').some(one => one.path.includes('cursor=cursor-1'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Earlier' })).not.toBeInTheDocument();
  });

  it('lists the newest five of what is over, and the rest of the page it holds once asked - without another read', async () => {
    server.alerts = Array.from({ length: 7 }, (_, index) =>
      alert({ id: `over-${index}`, startedAt: iso(NOW.minus({ hours: index + 2 })), resolvedAt: iso(NOW.minus({ hours: index + 1 })) }),
    );
    draw();

    const rows = () => within(screen.getByRole('region', { name: 'Over' })).getAllByRole('listitem');
    await waitFor(() => expect(rows()).toHaveLength(5));
    const reads = sentTo('GET', '/v1/alerts').length;
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));

    expect(rows()).toHaveLength(7);
    expect(sentTo('GET', '/v1/alerts')).toHaveLength(reads);
    expect(screen.queryByRole('button', { name: 'Earlier' })).not.toBeInTheDocument();
  });

  it('reads a name once and a rule only for the devices something went wrong on', async () => {
    server.alerts = [alert({}), alert({ id: 'second', startedAt: iso(NOW.minus({ minutes: 5 })) })];
    server.rules = [rule()];
    server.devices = [deviceRow(), deviceRow({ id: 'device-2', name: 'Mother tent', spaceId: 'space-2' })];
    draw();

    await waitFor(() => expect(screen.getAllByText(reading(/ · Flower room B · 68 % · above 60 %$/))).toHaveLength(2));
    await waitFor(() => expect(readsOf('/v1/devices/device-1/alarm-rules')).toHaveLength(1));
    expect(readsOf('/v1/devices/device-2/alarm-rules')).toHaveLength(0);
    expect(readsOf('/v1/spaces')).toHaveLength(1);
    expect(readsOf('/v1/devices')).toHaveLength(1);
    expect(readsOf('/v1/cameras')).toHaveLength(1);
    // Both halves of the list, the three names, the account behind the mute,
    // the home that says what is due, and one rule list: eight reads for two
    // alerts on one of two devices. Neither device has its updates off, so
    // none is asked for its builds.
    expect(server.sent.filter(one => one.method === 'GET').map(one => one.path.split('?')[0])).toHaveLength(8);
  });

  /** The inbox with one alert open, a little over two live beats after it was drawn. */
  const twoBeatsOn = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.alerts = [alert({})];
      server.rules = [rule()];
      draw();

      await screen.findByText(reading(/ · Flower room B · 68 % · above 60 %$/));
      await act(() => vi.advanceTimersByTimeAsync(65_000));
    } finally {
      // Back to the file's own noon, which the cases after this one date their devices by.
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW.toJSDate());
    }
  };

  it('keeps the list on the live beat and the rules at a walk', async () => {
    await twoBeatsOn();

    expect(readsOf('/v1/alerts').length).toBeGreaterThan(1);
    expect(readsOf('/v1/devices/device-1/alarm-rules')).toHaveLength(1);
  });

  /** A name changes when somebody renames something, never on its own: three lists re-read every beat were most of what this screen asked. */
  it('reads the names at a walk too', async () => {
    await twoBeatsOn();

    expect(readsOf('/v1/spaces')).toHaveLength(1);
    expect(readsOf('/v1/devices')).toHaveLength(1);
    expect(readsOf('/v1/cameras')).toHaveLength(1);
  });
});

/**
 * The same inbox, read by somebody who was let into that tent to write in its
 * diary. The cards are theirs to read - an alarm is news wherever it comes
 * from - and so are the curves it happened in. What a card would do to the
 * device is not: silencing a rule and editing it are `manage`, which the
 * server refuses them, so neither is there to be tapped.
 */
describe('a member who may only log', () => {
  beforeEach(() => {
    state.youMay = 'log';
    server.devices = [deviceRow({ ownerId: THE_HOST })];
  });

  it('reads an open card and its timeline, and is offered neither the silence nor the rule', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(reading(`${since} · Flower room B · 68 % · above 60 %`))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(reading(/^Humidity high · critical/))).toBeInTheDocument());
    expect(openCards()).toHaveLength(1);
    expect(within(openCards()[0]).getByRole('link', { name: 'Open timeline' })).toHaveAttribute(
      'href',
      `/timeline?space=space-1&device=device-1&focus=humidity&at=${encodeURIComponent(iso(NOW.minus({ hours: 2, minutes: 20 })))}`,
    );
    expect(within(openCards()[0]).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Silence 1 h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About Silence 1 h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit rule' })).not.toBeInTheDocument();
    // The mute is their own account's and stands above every place.
    expect(screen.getByRole('button', { name: 'Mute 1 h' })).toBeInTheDocument();
  });

  it('may not delete an episode that is over either', async () => {
    server.alerts = [alert({ resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    draw();

    const sheet = await openRow(/1 h ago$/);
    expect(within(sheet).getByRole('link', { name: 'Open timeline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('is what the owner is not: the owner gets the silence', async () => {
    state.youMay = 'own';
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByRole('button', { name: 'Silence 1 h' })).toBeInTheDocument();
  });
});

describe('the bell', () => {
  it('says the open count on the phone and on the rail: a dot on the phone´s bell, the figure on the rail', async () => {
    server.alerts = [alert({ id: 'a' }), alert({ id: 'b' }), alert({ id: 'c', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    draw(
      <>
        <TopBar />
        <Rail />
      </>,
    );

    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Alerts · 2 open' })).toHaveLength(2));
    const [phone, rail] = screen.getAllByRole('link', { name: 'Alerts · 2 open' });
    expect(phone.querySelector('[data-kind="alerts"]')).toBeEmptyDOMElement();
    expect(within(rail).getByText('2')).toHaveAttribute('data-kind', 'alerts');
  });

  it('says 99+ rather than a page count when another page stands behind the open one', async () => {
    server.alerts = [alert({ id: 'a' })];
    server.older = [alert({ id: 'b' })];
    draw(<Rail />);

    const link = await screen.findByRole('link', { name: 'Alerts · more than 99 open' });
    expect(within(link).getByText('99+')).toBeInTheDocument();
  });

  it('is quiet rather than zero when nothing is open', async () => {
    draw(<TopBar />);

    await waitFor(() => expect(sentTo('GET', '/v1/alerts')).toHaveLength(1));
    expect(await screen.findByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  /**
   * A device whose updates are off is handed nothing by the rollout: a newer
   * stable build waits for somebody's word, which makes it something open.
   */
  describe('with an update waiting for somebody´s word', () => {
    const RUNNING = {
      id: 'fw-old',
      createdAt: '2026-09-01T10:00:00.000Z',
      classId: 'class-1',
      name: null,
      version: 'a1b2c3d',
      wasStable: true,
      channels: [],
    };
    const NEWER = { ...RUNNING, id: 'fw-new', createdAt: '2026-09-15T10:00:00.000Z', version: 'e4f5a6b', channels: ['stable'] };
    const updatesOff = (over: Parameters<typeof deviceRow>[0] = {}) =>
      deviceRow({ firmware: { channel: 'manual', targetId: null }, ...over, state: { firmwareId: RUNNING.id, ...over.state } });

    beforeEach(() => {
      server.devices = [updatesOff()];
      server.builds = { 'device-1': [NEWER, RUNNING] as DeviceFirmware[] };
    });

    it('counts it as open, and the inbox lists it with the way to the device', async () => {
      draw(
        <>
          <TopBar />
          <Alerts />
        </>,
      );

      expect(await screen.findByRole('link', { name: 'Alerts · 1 open' })).toBeInTheDocument();
      const [update] = openCards();
      expect(update).toHaveTextContent('Firmware e4f5a6b is here');
      expect(update).toHaveTextContent('Blue Dream tent');
      expect(within(update).getByRole('link', { name: 'To the device' })).toHaveAttribute('href', '/devices/device-1');
      expect(screen.queryByText('Nothing is open right now.')).not.toBeInTheDocument();
    });

    it('counts it beside the alerts still standing, which the inbox lists first', async () => {
      server.alerts = [alert({ severity: 'info' })];
      server.rules = [rule()];
      draw(
        <>
          <TopBar />
          <Alerts />
        </>,
      );

      expect(await screen.findByRole('link', { name: 'Alerts · 2 open' })).toBeInTheDocument();
      expect(openCards().map(one => one.getAttribute('data-severity'))).toEqual(['info', null]);
    });

    it('asks only a device whose updates are off, and counts nothing that the rollout hands out, that is installed or that is on its way', async () => {
      server.devices = [
        updatesOff({ name: 'Up to date', state: { firmwareId: NEWER.id } }),
        deviceRow({ id: 'device-2', name: 'On the stable channel', state: { firmwareId: RUNNING.id } }),
        updatesOff({ id: 'device-3', name: 'Told to update', firmware: { channel: 'manual', targetId: NEWER.id } }),
        updatesOff({ id: 'device-4', name: 'Waiting' }),
      ];
      const offered = [NEWER, RUNNING] as DeviceFirmware[];
      server.builds = { 'device-1': offered, 'device-2': offered, 'device-3': offered, 'device-4': offered };
      draw(
        <>
          <TopBar />
          <Alerts />
        </>,
      );

      expect(await screen.findByRole('link', { name: 'Alerts · 1 open' })).toBeInTheDocument();
      await waitFor(() => expect(readsOf('/v1/devices/device-3/firmwares')).toHaveLength(1));
      expect(readsOf('/v1/devices/device-2/firmwares')).toHaveLength(0);
      expect(openCards()).toHaveLength(1);
      expect(openCards()[0]).toHaveTextContent('Waiting');
    });

    it('neither asks nor counts for a device a member could not update', async () => {
      state.youMay = 'log';
      server.devices = [updatesOff({ ownerId: THE_HOST }), updatesOff({ id: 'device-2', name: 'My own plug', spaceId: null })];
      server.builds['device-2'] = server.builds['device-1'];
      draw(
        <>
          <TopBar />
          <Alerts />
        </>,
      );

      // Their own device says that an update is counted at all; the host's is not theirs to install.
      expect(await screen.findByRole('link', { name: 'Alerts · 1 open' })).toBeInTheDocument();
      expect(openCards()).toHaveLength(1);
      expect(openCards()[0]).toHaveTextContent('My own plug');
      expect(readsOf('/v1/devices/device-1/firmwares')).toHaveLength(0);
    });
  });
});

/**
 * Tasks have no tab of their own: whoever keeps a diary finds what is due
 * behind the bell, beside everything else that is waiting on them, with the
 * way to the whole list under it. The rows are the ones Start lists under
 * "Today", counted from the same read, so the bell and the two lists agree.
 * An account that keeps no diary is not asked for a list, and the demo, which
 * may settle nothing, is offered none.
 */
describe('what is due', () => {
  const due = (id: string, label: string, dueAt: DateTime, over: Record<string, unknown> = {}) =>
    ({ id, kind: 'water', label, dueAt: iso(dueAt), subject: { type: 'grow', id: 'grow-1' }, assigneeId: null, defaults: null, ...over }) as Task;
  const growing = { growId: 'grow-1', name: 'Spring run' } as HomeSpaceCard['grow'];
  const tasks = () => screen.getByRole('region', { name: 'Tasks' });

  beforeEach(() => {
    server.me = keepsDiary;
  });

  it('lists what is due with the tap that settles each, and leads to the whole list', async () => {
    server.home = [
      card({
        grow: growing,
        dueTasks: [
          due('t1', 'Water', NOW.minus({ hours: 2 })),
          due('t2', 'Clean the filter', NOW.minus({ hours: 1 }), { kind: 'chore', subject: { type: 'space', id: 'space-1' } }),
          due('t3', 'Feed', NOW.plus({ days: 3 }), { kind: 'feed' }),
        ],
      }),
    ];
    server.tasks = [due('step-1', 'Week 3', NOW.minus({ minutes: 30 }), { source: 'plan_step', subject: { type: 'space', id: 'space-1' } })];
    draw();

    await waitFor(() => expect(within(tasks()).getAllByRole('listitem')).toHaveLength(3));
    expect(
      within(tasks())
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Enter: Water', 'Done: Clean the filter', 'Confirm: Week 3']);
    // The inbox stands above every place, so a row says where it is due.
    expect(within(tasks()).getAllByText(reading('Spring run · Flower room B'))).toHaveLength(2);
    expect(within(tasks()).getByText(reading('grow plan · Flower room B'))).toBeInTheDocument();
    expect(within(tasks()).getByRole('link', { name: 'All tasks and reminders ›' })).toHaveAttribute('href', '/tasks');
    // With nothing wrong the page still says so above what is due.
    expect(screen.getByText('Nothing is open right now.')).toBeInTheDocument();

    fireEvent.click(within(tasks()).getByRole('button', { name: 'Done: Clean the filter' }));
    await waitFor(() => expect(sentTo('POST', '/v1/tasks/t2/completions')).toHaveLength(1));
  });

  it('keeps the way to the list where nothing is due', async () => {
    draw();

    expect(await screen.findByRole('link', { name: 'All tasks and reminders ›' })).toHaveAttribute('href', '/tasks');
    expect(within(tasks()).queryByRole('list')).not.toBeInTheDocument();
  });

  it('offers the demo no tasks, which it could not settle', async () => {
    state.who = 'demo';
    server.home = [card({ grow: growing, dueTasks: [due('t1', 'Water', NOW.minus({ hours: 2 }))] })];
    draw(
      <>
        <TopBar />
        <Alerts />
      </>,
    );

    expect(await screen.findByText('The demo has no inbox; open a place to see its alarms.')).toBeInTheDocument();
    await waitFor(() => expect(readsOf('/v1/home')).not.toHaveLength(0));
    expect(screen.queryByRole('heading', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /tasks/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Water')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(readsOf('/v1/tasks')).toHaveLength(0);
  });

  it('counts what is due on the bell, in blue, where no alarm is open: the reminders and a plan step waiting', async () => {
    server.home = [card({ grow: growing, dueTasks: [due('t1', 'Water', NOW.minus({ hours: 2 })), due('t2', 'Feed', NOW.plus({ days: 3 }))] })];
    server.tasks = [due('step-1', 'Week 3', NOW.minus({ minutes: 30 }), { source: 'plan_step', subject: { type: 'space', id: 'space-1' } })];
    draw(
      <>
        <TopBar />
        <Rail />
      </>,
    );

    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Alerts · 2 tasks due' })).toHaveLength(2));
    const [phone, rail] = screen.getAllByRole('link', { name: 'Alerts · 2 tasks due' });
    expect(phone.querySelector('[data-kind="tasks"]')).toBeEmptyDOMElement();
    expect(within(rail).getByText('2')).toHaveAttribute('data-kind', 'tasks');
  });

  it('counts what is open before what is due', async () => {
    server.alerts = [alert({})];
    server.home = [card({ grow: growing, dueTasks: [due('t1', 'Water', NOW.minus({ hours: 2 })), due('t2', 'Water', NOW.minus({ hours: 1 }))] })];
    draw(<Rail />);

    const bell = await screen.findByRole('link', { name: 'Alerts · 1 open' });
    expect(within(bell).getByText('1')).toHaveAttribute('data-kind', 'alerts');
  });

  it('offers an account that keeps no diary no tasks, and asks it for no list', async () => {
    server.me = me;
    server.home = [card({ dueTasks: [due('t1', 'Water', NOW.minus({ hours: 2 }), { subject: { type: 'space', id: 'space-1' } })] })];
    draw(
      <>
        <TopBar />
        <Alerts />
      </>,
    );

    expect(await screen.findByText('Nothing is open right now.')).toBeInTheDocument();
    // Until the account has said that it keeps none, the app is drawn as it always was.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Tasks' })).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /tasks/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(readsOf('/v1/tasks')).toHaveLength(0);
  });
});

describe('the arithmetic behind the cards', () => {
  /**
   * A band that is moved while its episode is open leaves the alert with the
   * reading it was raised on and the rule with an edge that reading never went
   * past, and the card used to print the pair as a crossing: "humidity 41 % ›
   * 60". Nothing on the alert can name the edge it really crossed, so the edge
   * is dropped and the reading stands alone. A reading exactly on the edge is
   * inside the band, because that is where the engine puts it.
   */
  it('names the edge a reading crossed, and no edge at all for a reading inside the band', () => {
    expect(crossedBound({ upper: 60, lower: 40 }, 68)).toEqual({ over: true, bound: 60 });
    expect(crossedBound({ upper: 60, lower: 40 }, 32)).toEqual({ over: false, bound: 40 });
    expect(crossedBound({ upper: 60, lower: 40 }, 50)).toBeNull();
    expect(crossedBound({ upper: 60, lower: 40 }, 60)).toBeNull();
    expect(crossedBound({ upper: null, lower: 40 }, null)).toEqual({ over: false, bound: 40 });
    expect(crossedBound({ upper: null, lower: null }, 50)).toBeNull();
  });

  /**
   * The whole card, because the arithmetic alone does not say what a reader
   * sees: a rule widened past the reading its open episode was raised on leaves
   * the reading and drops the claim, rather than asserting a bound the reading
   * is nowhere near - in the title, which falls back to the rule's name, and on
   * the line under it.
   */
  it('drops the bound from a card whose rule was widened while the episode was open', async () => {
    server.alerts = [alert({ value: 41, extremeValue: 68 })];
    server.rules = [rule({ watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null } })];
    draw();

    expect(await screen.findByLabelText('critical · Humidity high')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 41 %`))).toBeInTheDocument();
    expect(screen.queryByText(/above 60|too high/)).not.toBeInTheDocument();
  });

  /**
   * An episode that kept the band it was raised against is measured against
   * that band, not the one its rule has been moved to since: the card names the
   * edge the reading really crossed, while the rule it can still be edited from
   * says something else.
   */
  it('names the edge the episode was raised against after its rule was moved', async () => {
    server.alerts = [
      alert({ value: 41, extremeValue: 44, watched: { name: 'Too humid', watch: { kind: 'reading', metric: 'humidity', upper: 30, lower: null } } }),
    ];
    server.rules = [rule({ watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null } })];
    draw();

    expect(await screen.findByLabelText('critical · Humidity too high')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 41 % · above 30 %`))).toBeInTheDocument();
    expect(screen.queryByText(/above 60/)).not.toBeInTheDocument();
  });

  it('says which way a reading left its band, below as well as above', async () => {
    server.alerts = [alert({ value: 38, extremeValue: 36, severity: 'warning' })];
    server.rules = [rule({ name: 'Too dry', severity: 'warning', watch: { kind: 'reading', metric: 'humidity', upper: 70, lower: 45 } })];
    draw();

    expect(await screen.findByLabelText('warning · Humidity too low')).toBeInTheDocument();
    expect(screen.getByText(reading(`${since} · Flower room B · 38 % · below 45 %`))).toBeInTheDocument();
  });

  it('says the kind alone where an alarm watched an output and carries no metric', () => {
    const open = (over: Partial<OpenAlert>): OpenAlert => ({
      alertId: 'alert-1',
      kind: 'threshold',
      severity: 'critical',
      startedAt: iso(NOW),
      value: 68,
      metric: 'humidity',
      name: null,
      ...over,
    });

    expect(alertLabel(i18next.t, open({}), NOW)).toBe('Alarm · 68 % Humidity');
    // Two rules on one sensor are two banners on one place, told apart by name.
    expect(alertLabel(i18next.t, open({ name: 'Mould watch' }), NOW)).toBe('Mould watch · 68 % Humidity');
    // A rule watching an output leaves a number with no unit and no name, and
    // "Alarm · 1" reads as a count of something.
    expect(alertLabel(i18next.t, open({ metric: null, value: 1 }), NOW)).toBe('Alarm');
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: null, value: null }), NOW)).toBe('Offline');
    // `offline` is a metric so the health loop's rule can be an ordinary
    // reading rule, and the reading is a number of seconds. Drawn as a figure
    // it said "337256 offline" on a real tent nobody had heard from in days.
    // It is dated from when the device was last heard - the hour today, the
    // day and the hour before that - in the words every silence is said in.
    const heard = (seconds: number) => {
      const at = NOW.minus({ seconds });
      return at.hasSame(NOW, 'day') ? at.toFormat('HH:mm') : at.toFormat('d LLL HH:mm');
    };
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: 'offline', value: 337_255.9 }), NOW)).toBe(`Offline since ${heard(337_255.9)}`);
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: 'offline', value: 900 }), NOW)).toBe(`Offline since ${heard(900)}`);
    // Dated from the start of the silence rather than from the raise, so the words stand still while it goes on.
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: 'offline', value: 337_255.9 }), NOW.plus({ days: 1 }))).toBe(
      `Offline since ${heard(337_255.9)}`,
    );
  });

  it('orders what is open by how bad it is and then by the clock, and leaves the list it was handed as it was', () => {
    const open = [
      alert({ id: 'warn', severity: 'warning', startedAt: iso(NOW.minus({ minutes: 5 })) }),
      alert({ id: 'info', severity: 'info', startedAt: iso(NOW.minus({ minutes: 1 })) }),
      alert({ id: 'old-critical', severity: 'critical', startedAt: iso(NOW.minus({ days: 3 })) }),
      alert({ id: 'new-critical', severity: 'critical', startedAt: iso(NOW.minus({ hours: 1 })) }),
    ];

    expect(worstFirst(open).map(one => one.id)).toEqual(['new-critical', 'old-critical', 'warn', 'info']);
    expect(open.map(one => one.id)).toEqual(['warn', 'info', 'old-critical', 'new-critical']);
  });
});
