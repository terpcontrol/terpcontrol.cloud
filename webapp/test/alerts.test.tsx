import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRule, Alert, Me, OpenAlert, Problem } from '@fg2/shared-types/v1';
import { Rail } from '@/app/shell/Rail';
import { TopBar } from '@/app/shell/TopBar';
import { LogProvider } from '@/log/LogProvider';
import { Alerts } from '@/screens/Alerts';
import { crossedBound, groupsOf } from '@/screens/alerts/inbox';
import { alertLabel } from '@/screens/home/units';
import { spaceWhere } from './session';

/**
 * The inbox behind the bell is the alarm engine's own record drawn as it came,
 * so what is checked here is the reading of it - which day a card is filed
 * under, what a rule lets the card say - and what a tap sends, byte for byte:
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

const NOW = DateTime.now();
const iso = (at: DateTime) => at.toISO()!;
/** The zone the account below keeps, which is the one every clock time on these cards is drawn in whatever zone the suite runs in. */
const ACCOUNT_ZONE = 'Europe/Berlin';
const clock = (at: DateTime) => at.setZone(ACCOUNT_ZONE).toFormat('HH:mm');

/**
 * A card's whole first line. The figure in it is its own element, set in mono
 * and tied to its unit by a no-break space, so the line is read off the
 * paragraph rather than looked up as one piece of text.
 */
const title = (line: string) => (_: string, node: Element | null) => node?.tagName === 'P' && node.textContent?.replace(/\u00a0/g, ' ') === line;

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
  value: 68,
  extremeValue: 71,
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
} as unknown as Me;

const deviceRow = (over: Record<string, unknown> = {}) => ({
  id: 'device-1',
  type: 'controller',
  name: 'Blue Dream tent',
  spaceId: 'space-1',
  state: { lastSeenAt: iso(NOW.minus({ minutes: 1 })) },
  ...over,
});

/** What the stubbed server holds, and every request it was sent. */
const server = {
  alerts: [] as Alert[],
  /** The page behind the cursor: an empty one is a list with no `nextCursor`. */
  older: [] as Alert[],
  rules: [] as AlarmRule[],
  devices: [deviceRow()] as Record<string, unknown>[],
  cameras: [{ id: 'cam-2', name: 'Cam 2' }] as Record<string, unknown>[],
  me,
  sent: [] as { method: string; path: string; body: unknown }[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status < 400 ? 'application/json' : 'application/problem+json' } });

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
  // What a card offers - silencing the rule, sending the tent into maintenance -
  // is `manage` where the alert happened, so the space list carries the standing.
  if (method === 'GET' && path === '/v1/spaces')
    return json({ items: [spaceWhere(state.youMay, { id: 'space-1', name: 'Flower room B' })], nextCursor: null });
  if (method === 'GET' && path === '/v1/devices') return json({ items: server.devices, nextCursor: null });
  if (method === 'GET' && path === '/v1/cameras') return json({ items: server.cameras, nextCursor: null });
  if (method === 'GET' && path.startsWith('/v1/devices/device-1/alarm-rules')) return json({ items: server.rules, nextCursor: null });
  if (method === 'GET' && path === '/v1/me') return json(server.me);
  if (method === 'PUT' && path.startsWith('/v1/alarm-rules/')) return json(server.rules[0]);
  if (method === 'DELETE' && path.startsWith('/v1/alarm-rules/')) return json(server.rules[0]);
  if (method === 'PATCH' && path === '/v1/me') return json({ ...server.me, ...(body as Partial<Me>) });
  if (method === 'POST' && path.startsWith('/v1/devices/device-1/commands')) return json({ publishedAt: iso(NOW), deviceOnline: true });
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: `No route for ${method} ${path}`, errors: [] }, 404);
};

const draw = (ui: React.ReactNode = <Alerts />) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>{ui}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const sentTo = (method: string, path: string) => server.sent.filter(one => one.method === method && one.path.startsWith(path));

/** Reads of one route exactly, for counting them: `/v1/devices` is not `/v1/devices/device-1/alarm-rules`. */
const readsOf = (path: string) => server.sent.filter(one => one.method === 'GET' && one.path.split('?')[0] === path);

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

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
  server.me = me;
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

describe('the inbox', () => {
  it('says nothing has gone wrong when nothing has, and still explains itself', async () => {
    draw();

    expect(await screen.findByText('Nothing has gone wrong.')).toBeInTheDocument();
    expect(screen.getByText(/One line per event, graded by severity/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says instead that nothing is watching, and drops the note about pushes, where no hardware can raise anything', async () => {
    server.devices = [];
    server.cameras = [];
    draw();

    expect(await screen.findByText("Nothing is watching yet. Alerts come from a controller's alarm rules and from a cam.")).toBeInTheDocument();
    expect(screen.queryByText('Nothing has gone wrong.')).not.toBeInTheDocument();
    expect(screen.queryByText(/One line per event, graded by severity/)).not.toBeInTheDocument();
  });

  it('files every open alert under NOW and the resolved ones under the day they began', async () => {
    const today = NOW.startOf('day');
    server.alerts = [
      alert({ id: 'open' }),
      alert({
        id: 'today',
        kind: 'offline',
        ruleId: null,
        startedAt: iso(today),
        resolvedAt: iso(today.plus({ minutes: 6 })),
        value: null,
        severity: 'warning',
      }),
      alert({ id: 'yesterday', startedAt: iso(today.minus({ hours: 12 })), resolvedAt: iso(today.minus({ hours: 11, minutes: 20 })) }),
      alert({
        id: 'older',
        startedAt: iso(today.minus({ days: 5 })),
        resolvedAt: iso(today.minus({ days: 5 }).plus({ hours: 1 })),
        severity: 'info',
      }),
    ];
    server.rules = [rule()];
    draw();

    await screen.findByText('Now');
    const headings = screen.getAllByText((_, node) => node?.classList.contains('label') === true).map(node => node.textContent);
    expect(headings).toEqual(['Now', 'Earlier today', 'Yesterday', today.minus({ days: 5 }).toFormat('ccc d LLL')]);
    expect(screen.getByText('1 active')).toBeInTheDocument();

    const lists = screen.getAllByRole('list');
    expect(within(lists[1]).getByText('Flower room B · was offline')).toBeInTheDocument();
    expect(within(lists[1]).getByText(`warning · resolved ${clock(today.plus({ minutes: 6 }))} · lasted 6 min`)).toBeInTheDocument();
    expect(within(lists[3]).getByText(/^Humidity high · info · resolved/)).toBeInTheDocument();
    // A resolved card is dimmed and dated, never dropped - and offers only the timeline.
    expect(lists[1].firstElementChild).toHaveAttribute('data-age', 'stale');
    expect(
      within(lists[1])
        .getAllByRole('link')
        .map(link => link.textContent),
    ).toEqual(['Open timeline']);
  });

  it('says what the rule watched, the reading and the edge it crossed, and how the rule will go on', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(title('Flower room B · humidity 68 % › 60'))).toBeInTheDocument();
    expect(
      screen.getByText(
        `Humidity high · critical · since ${clock(NOW.minus({ hours: 2, minutes: 20 }))} · for 2 h · repeats every 30 min until resolved`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open timeline' })).toHaveAttribute('href', '/spaces/space-1/timeline');
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/spaces/space-1/control/alarms?rule=rule-1');
  });

  it('names the severity to anybody who cannot see the coloured edge, and keeps the figure and its unit in one piece', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByLabelText('critical · Flower room B · humidity · 68 % › 60')).toBeInTheDocument();
    // The reading is set in mono like every other figure, and neither the unit
    // nor the bound may be wrapped away from the number it belongs to.
    const reading = screen.getByText(/68/, { selector: 'span.mono' });
    expect(reading.textContent).toBe('68 % › 60');
  });

  it('names the output for a rule that watches one, leaves an empty span off, and says only the kind once the rule is gone', async () => {
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

    expect(await screen.findByText(title('Flower room B · dehumidifier running non-stop › 2 h'))).toBeInTheDocument();
    expect(screen.getByText(/announced once$/)).toBeInTheDocument();
    // A rule that trips the moment the output starts has no span worth drawing,
    // on the line that says what happened or on the one that says what the rule
    // will go on doing.
    expect(screen.getByText('Flower room B · heater running non-stop')).toBeInTheDocument();
    expect(screen.queryByText(/0 s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/›\s*0/)).not.toBeInTheDocument();
    expect(screen.getByText(title('Flower room B · alarm 68'))).toBeInTheDocument();
  });

  it('keeps the grade the episode was raised at, says what its rule says now, and promises only what that grade gets', async () => {
    server.alerts = [alert({ severity: 'warning' })];
    server.rules = [rule({ severity: 'critical' })];
    draw();

    const since = clock(NOW.minus({ hours: 2, minutes: 20 }));
    expect(
      await screen.findByText(
        `Humidity high · warning · since ${since} · for 2 h · the rule now says critical · repeats every 30 min until resolved`,
      ),
    ).toBeInTheDocument();
    // The coloured edge is the same one decision, not the rule's.
    expect(screen.getByRole('listitem')).toHaveAttribute('data-severity', 'warning');
  });

  it('announces an info alarm nowhere, and says of a routed one that nobody would have heard it', async () => {
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

    expect(await screen.findByText(/^Leaf cool · info · .* · not announced$/)).toBeInTheDocument();
    // A row of the grid that names only a channel this account cannot be
    // reached on is a rule nobody would hear.
    expect(screen.getByText(/^Humidity high · warning · .* · nobody was listening$/)).toBeInTheDocument();
    expect(screen.queryByText(/announced once/)).not.toBeInTheDocument();
  });

  /**
   * Two alerts in one undeliverable state used to read as two different states:
   * the rule-backed one said nobody was listening and the camera the health
   * loop raised said nothing, which is the shape of a card that did reach
   * somebody.
   */
  it('says of a camera no rule raised that nobody heard it either, and that it is said once', async () => {
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

    expect(await screen.findByText(/^warning · since .* · nobody was listening$/)).toBeInTheDocument();
    // The account can be reached for a critical alarm, so the card beside it
    // says what it will go on doing rather than that it reached nobody.
    expect(screen.getByText(/^Device offline · critical · .* · repeats every 30 min until resolved$/)).toBeInTheDocument();
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

    expect(await screen.findByText(/^warning · since .* · announced once$/)).toBeInTheDocument();
  });

  /** Not having a rule is one thing; naming one the page has not got is another, and only the first is a delivery this screen can read. */
  it('stays silent about delivery where the alert names a rule the list could not answer for', async () => {
    server.alerts = [alert({ id: 'orphan', ruleId: 'rule-gone' })];
    server.rules = [];
    draw();

    expect(await screen.findByText(/^critical · since .* · for .*$/)).toBeInTheDocument();
    expect(screen.queryByText(/announced once|nobody was listening|not announced|repeats every/)).not.toBeInTheDocument();
  });

  it('promises nothing about a ruleless alert that has already resolved', async () => {
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

    expect(await screen.findByText(/^warning · resolved .* · lasted .*$/)).toBeInTheDocument();
    expect(screen.queryByText(/announced once|nobody was listening|not announced/)).not.toBeInTheDocument();
  });

  it('puts the worst first under NOW and lets the clock decide only between equals', async () => {
    server.alerts = [
      alert({ id: 'warn', severity: 'warning', startedAt: iso(NOW.minus({ minutes: 5 })) }),
      alert({ id: 'info', severity: 'info', startedAt: iso(NOW.minus({ minutes: 1 })) }),
      alert({ id: 'old-critical', severity: 'critical', startedAt: iso(NOW.minus({ hours: 4 })) }),
      alert({ id: 'new-critical', severity: 'critical', startedAt: iso(NOW.minus({ hours: 1 })) }),
    ];
    server.rules = [rule()];
    draw();

    await screen.findByText('Now');
    const cards = within(screen.getAllByRole('list')[0]).getAllByRole('listitem');
    expect(cards.map(card => card.getAttribute('data-severity'))).toEqual(['critical', 'critical', 'warning', 'info']);
    expect(cards[0].textContent).toContain(`since ${clock(NOW.minus({ hours: 1 }))}`);
  });

  it('names the device as well as the tent where the tent holds more than one', async () => {
    server.devices = [deviceRow(), deviceRow({ id: 'device-2', name: 'Cutting fridge' })];
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(title('Flower room B · Blue Dream tent · humidity 68 % › 60'))).toBeInTheDocument();
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

    expect(await screen.findByText(title('humidity 68 % › 60'))).toBeInTheDocument();
    arrive();
    expect(await screen.findByText(title('Flower room B · humidity 68 % › 60'))).toBeInTheDocument();
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

    expect(await screen.findByText(title('space-1 · humidity 68 % › 60'))).toBeInTheDocument();
    expect(screen.getByText('Could not read the names · spaces, devices and cams are shown by their id')).toBeInTheDocument();
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

    const link = await screen.findByRole('link', { name: 'Alerts · 1 open' });
    expect(within(link).getByText('1')).toBeInTheDocument();
    await waitFor(() => expect(readsOf('/v1/alerts')).toHaveLength(2));
    // One read of what is open, one of what is over, and the badge on top of
    // neither: the bell counts the list the inbox is drawing.
    expect(readsOf('/v1/alerts').filter(one => one.path.includes('open=true'))).toHaveLength(1);
    expect(readsOf('/v1/alerts').filter(one => one.path.includes('open=false'))).toHaveLength(1);
  });

  it('dates an offline alert from when the device was last heard rather than from when the cloud noticed', async () => {
    server.alerts = [alert({ id: 'off', kind: 'offline', ruleId: null, severity: 'warning', value: null, startedAt: iso(NOW.minus({ hours: 3 })) })];
    server.devices = [deviceRow({ state: { lastSeenAt: iso(NOW.minus({ minutes: 25 })) } })];
    draw();

    // Heard, not sampled: the two are different beats and the app draws both,
    // so the word has to name the one this figure is counted from.
    expect(await screen.findByText('Flower room B · offline · last heard 25 min ago')).toBeInTheDocument();
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
        resolvedAt: iso(NOW.minus({ minutes: 29 })),
        value: raised.diff(raised.minus(dark)).as('seconds'),
        extremeValue: raised.diff(raised.minus(dark)).as('seconds'),
      }),
    ];
    draw();

    // Four days back is not today, so the day is named beside the hour rather
    // than a bare time that reads as this morning.
    const lastStill = raised.minus(dark).setZone(ACCOUNT_ZONE).toFormat('d MMM HH:mm');
    expect(await screen.findByText(new RegExp(`no image since ${lastStill}`))).toBeInTheDocument();
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

    expect(await screen.findByText(`Cam 2 · no image since ${clock(raised)}`)).toBeInTheDocument();
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

  it('offers the way out of a silence, and says until when it holds', async () => {
    server.alerts = [alert({})];
    server.rules = [rule({ silencedUntil: iso(NOW.plus({ minutes: 40 })) })];
    draw();

    expect(await screen.findByText(new RegExp(`silenced for everyone until ${clock(NOW.plus({ minutes: 40 }))}$`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unsilence' }));

    await waitFor(() => expect(sentTo('DELETE', '/v1/alarm-rules/rule-1/silence')).toHaveLength(1));
  });

  // Maintenance parks the heater, the dehumidifier and the CO2 valve as well as
  // the alarms, so the chip says what that means before anything is sent.
  it('asks the device for a quarter of an hour of maintenance, after saying what it stops', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Maintenance 15 min' }));
    expect(sentTo('POST', '/v1/devices/device-1/commands')).toHaveLength(0);
    expect(screen.getByText(/stops the heater, the dehumidifier and the CO₂ valve/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start maintenance' }));

    await waitFor(() => expect(sentTo('POST', '/v1/devices/device-1/commands')).toHaveLength(1));
    expect(sentTo('POST', '/v1/devices/device-1/commands')[0].body).toEqual({ kind: 'maintenance', forSeconds: 900 });
    expect(await screen.findByRole('status')).toHaveTextContent('Asked.');
  });

  it('sends nothing when the maintenance question is cancelled', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Maintenance 15 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/stops the heater/)).not.toBeInTheDocument();
    expect(sentTo('POST', '/v1/devices/device-1/commands')).toHaveLength(0);
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

  it('mutes everything for an hour by handing the whole notification object back', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Mute all 1 h' }));

    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(1));
    const { notifications } = sentTo('PATCH', '/v1/me')[0].body as Me;
    expect(notifications).toEqual({ ...me.notifications, mutedUntil: expect.any(String) });
    const until = DateTime.fromISO(notifications.mutedUntil!);
    expect(Math.abs(until.diff(DateTime.now(), 'minutes').minutes - 60)).toBeLessThan(1);
    expect(notifications.mutedUntil).toMatch(/Z$/);

    expect(await screen.findByText(`your channels muted until ${clock(until)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(2));
    expect((sentTo('PATCH', '/v1/me')[1].body as Me).notifications.mutedUntil).toBeNull();
  });

  it('tells the demo where the alarms are instead of calling its empty page a quiet tent, and offers it nothing that writes', async () => {
    state.who = 'demo';
    // Whatever the demo's tents hold, the route answers a demo session an empty page.
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText('The demo has no inbox; open a space to see its alarms.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing has gone wrong.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  /** The route answers a demo session `403 no_account`, so the screen that knows it would be refused does not ask. */
  it('asks the demo session nothing about an account', async () => {
    state.who = 'demo';
    draw();

    expect(await screen.findByText('The demo has no inbox; open a space to see its alarms.')).toBeInTheDocument();
    expect(readsOf('/v1/me')).toHaveLength(0);
  });

  it('still reads the account for somebody who has one, and reads it once for the list and the mute together', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByRole('button', { name: 'Mute all 1 h' })).toBeInTheDocument();
    expect(readsOf('/v1/me')).toHaveLength(1);
  });

  it('follows the cursor it was given when the reader asks for what came before, without taking back what is on screen', async () => {
    const older = NOW.startOf('day').minus({ days: 4 });
    server.alerts = [alert({ id: 'open' })];
    server.older = [alert({ id: 'older', deviceId: 'device-2', ruleId: 'rule-9', startedAt: iso(older), resolvedAt: iso(older.plus({ hours: 1 })) })];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Earlier' }));

    expect(await screen.findByText(older.toFormat('ccc d LLL'))).toBeInTheDocument();
    // The rules of a device the older page brings with it must not blank the page.
    expect(screen.getByText(title('Flower room B · humidity 68 % › 60'))).toBeInTheDocument();
    expect(sentTo('GET', '/v1/alerts').some(one => one.path.includes('cursor=cursor-1'))).toBe(true);
  });

  it('reads a name once and a rule only for the devices something went wrong on', async () => {
    server.alerts = [alert({}), alert({ id: 'second', startedAt: iso(NOW.minus({ minutes: 5 })) })];
    server.rules = [rule()];
    server.devices = [deviceRow(), deviceRow({ id: 'device-2', name: 'Mother tent', spaceId: 'space-2' })];
    draw();

    await waitFor(() => expect(screen.getAllByText(title('Flower room B · humidity 68 % › 60'))).toHaveLength(2));
    await waitFor(() => expect(readsOf('/v1/devices/device-1/alarm-rules')).toHaveLength(1));
    expect(readsOf('/v1/devices/device-2/alarm-rules')).toHaveLength(0);
    expect(readsOf('/v1/spaces')).toHaveLength(1);
    expect(readsOf('/v1/devices')).toHaveLength(1);
    expect(readsOf('/v1/cameras')).toHaveLength(1);
    // Both halves of the list, the three names, the account behind the mute,
    // and one rule list: seven reads for two alerts on one of two devices.
    expect(server.sent.filter(one => one.method === 'GET')).toHaveLength(7);
  });

  it('keeps the list on the live beat and the rules at a walk', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.alerts = [alert({})];
      server.rules = [rule()];
      draw();

      await screen.findByText(title('Flower room B · humidity 68 % › 60'));
      await vi.advanceTimersByTimeAsync(65_000);

      expect(readsOf('/v1/alerts').length).toBeGreaterThan(1);
      expect(readsOf('/v1/devices/device-1/alarm-rules')).toHaveLength(1);
      expect(readsOf('/v1/devices')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The same inbox, read by somebody who was let into that tent to write in its
 * diary. The cards are theirs to read - an alarm is news wherever it comes
 * from - and everything a card would do to the device is not: silencing a rule
 * and parking the tent for a quarter of an hour are `manage`, which the server
 * refuses them, so the chips are not there to be tapped.
 */
describe('a member who may only log', () => {
  beforeEach(() => {
    state.youMay = 'log';
  });

  it('reads the card and is offered neither the silence nor the maintenance', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText(/Flower room B/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Silence 1 h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maintenance 15 min' })).not.toBeInTheDocument();
  });

  it('is what the owner is not: the owner gets both chips', async () => {
    state.youMay = 'own';
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByRole('button', { name: 'Silence 1 h' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maintenance 15 min' })).toBeInTheDocument();
  });
});

describe('the bell', () => {
  it('carries the open count on the phone and on the rail, and says it', async () => {
    server.alerts = [alert({ id: 'a' }), alert({ id: 'b' }), alert({ id: 'c', resolvedAt: iso(NOW.minus({ hours: 1 })) })];
    draw(
      <>
        <TopBar />
        <Rail />
      </>,
    );

    const links = await screen.findAllByRole('link', { name: 'Alerts · 2 open' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(within(link).getByText('2')).toBeInTheDocument();
  });

  it('says 99+ rather than a page count when another page stands behind the open one', async () => {
    server.alerts = [alert({ id: 'a' })];
    server.older = [alert({ id: 'b' })];
    draw(<TopBar />);

    const link = await screen.findByRole('link', { name: 'Alerts · more than 99 open' });
    expect(within(link).getByText('99+')).toBeInTheDocument();
  });

  it('is quiet rather than zero when nothing is open', async () => {
    draw(<TopBar />);

    await waitFor(() => expect(sentTo('GET', '/v1/alerts')).toHaveLength(1));
    expect(await screen.findByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('the arithmetic behind the cards', () => {
  it('names the edge a reading crossed, and the upper one when it is in between', () => {
    expect(crossedBound({ upper: 60, lower: 40 }, 68)).toEqual({ over: true, bound: 60 });
    expect(crossedBound({ upper: 60, lower: 40 }, 32)).toEqual({ over: false, bound: 40 });
    expect(crossedBound({ upper: 60, lower: 40 }, 50)).toEqual({ over: true, bound: 60 });
    expect(crossedBound({ upper: null, lower: 40 }, null)).toEqual({ over: false, bound: 40 });
    expect(crossedBound({ upper: null, lower: null }, 50)).toBeNull();
  });

  it('says the kind alone where an alarm watched an output and carries no metric', () => {
    const open = (over: Partial<OpenAlert>): OpenAlert => ({
      alertId: 'alert-1',
      kind: 'threshold',
      severity: 'critical',
      startedAt: iso(NOW),
      value: 68,
      metric: 'humidity',
      ...over,
    });

    expect(alertLabel(i18next.t, open({}))).toBe('Alarm · 68 % RH');
    // A rule watching an output leaves a number with no unit and no name, and
    // "Alarm · 1" reads as a count of something.
    expect(alertLabel(i18next.t, open({ metric: null, value: 1 }))).toBe('Alarm');
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: null, value: null }))).toBe('Offline');
    // `offline` is a metric so the health loop's rule can be an ordinary
    // reading rule, and the reading is a number of seconds. Drawn as a figure
    // it said "337256 offline" on a real tent nobody had heard from in days.
    // Counted from when the device was last heard, which is not the instant of
    // its last sample and is worded so rather than as a silence of readings.
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: 'offline', value: 337_255.9 }))).toBe('Offline · last heard 3 d ago');
    expect(alertLabel(i18next.t, open({ kind: 'offline', metric: 'offline', value: 900 }))).toBe('Offline · last heard 15 min ago');
  });

  it('keeps an open alert under NOW however long ago it began', () => {
    // Midday, not the actual clock: the resolved card below is grouped by the
    // day it began in the account's own zone, so a suite run in the small hours
    // put a card two hours old under yesterday and failed a test about today.
    // The day boundary the app reads is the right one; the hour this test
    // picked was not.
    const midday = NOW.startOf('day').plus({ hours: 12 });
    const groups = groupsOf(
      [alert({ startedAt: iso(midday.minus({ days: 3 })) }), alert({ id: 'r', startedAt: iso(midday), resolvedAt: iso(midday) })],
      midday,
      null,
    );

    expect(groups.map(group => group.heading.kind)).toEqual(['now', 'earlierToday']);
  });

  it('files a resolved alert under the day it began on where the account is, not where the browser is', () => {
    // Half past ten at night in Berlin is already the next day in Tokyo, and
    // an account that keeps its clock there is owed the day its own quiet
    // hours are counted in.
    const berlinNight = DateTime.fromISO('2026-05-04T22:30:00+02:00');
    const resolved = alert({ id: 'r', startedAt: iso(berlinNight), resolvedAt: iso(berlinNight.plus({ minutes: 5 })) });

    const inTokyo = groupsOf([resolved], berlinNight, 'Asia/Tokyo');
    const inBerlin = groupsOf([resolved], berlinNight, 'Europe/Berlin');

    expect(inTokyo[0].key).toBe('2026-05-05');
    expect(inBerlin[0].key).toBe('2026-05-04');
  });
});
