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
import type { AlarmRule, Alert, Me, Problem } from '@fg2/shared-types/v1';
import { Rail } from '@/app/shell/Rail';
import { TopBar } from '@/app/shell/TopBar';
import { LogProvider } from '@/log/LogProvider';
import { Alerts } from '@/screens/Alerts';
import { crossedBound, groupsOf } from '@/screens/alerts/inbox';

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
  refuse: null as { method: string; path: string; problem: Problem } | null,
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
const clock = (at: DateTime) => at.toFormat('HH:mm');

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
  preferences: { weightUnit: 'grams', volumeUnit: 'liters' },
  retention: { entriesDays: null, mediaDays: null },
  notifications: {
    channels: { email: true, push: false, telegram: null, webhook: null },
    routing: { alerts: ['email'], warnings: ['email'], tasks: [], plan: [], weekly_timelapse: [] },
    quietHours: null,
    mutedUntil: null,
  },
} as unknown as Me;

/** What the stubbed server holds, and every request it was sent. */
const server = {
  alerts: [] as Alert[],
  rules: [] as AlarmRule[],
  me,
  sent: [] as { method: string; path: string; body: unknown }[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status < 400 ? 'application/json' : 'application/problem+json' } });

const answer = (method: string, path: string, body: unknown): Response => {
  if (state.refuse && state.refuse.method === method && path.startsWith(state.refuse.path))
    return json(state.refuse.problem, state.refuse.problem.status);
  if (method === 'GET' && path.startsWith('/v1/alerts')) {
    const open = new URL(path, 'http://x').searchParams.get('open');
    return json({ items: open === 'true' ? server.alerts.filter(one => one.resolvedAt === null) : server.alerts, nextCursor: null });
  }
  if (method === 'GET' && path === '/v1/spaces') return json({ items: [{ id: 'space-1', name: 'Flower room B' }], nextCursor: null });
  if (method === 'GET' && path === '/v1/devices')
    return json({ items: [{ id: 'device-1', type: 'controller', name: 'Blue Dream tent' }], nextCursor: null });
  if (method === 'GET' && path === '/v1/cameras') return json({ items: [{ id: 'cam-2', name: 'Cam 2' }], nextCursor: null });
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

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  state.who = 'you';
  state.refuse = null;
  server.alerts = [];
  server.rules = [];
  server.me = me;
  server.sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      server.sent.push({ method, path: url.pathname + url.search, body });
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
    expect(within(lists[1]).getByText(`resolved ${clock(today.plus({ minutes: 6 }))} · lasted 6 min`)).toBeInTheDocument();
    expect(within(lists[3]).getByText(/low priority$/)).toBeInTheDocument();
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

    expect(await screen.findByText('Flower room B · RH 68 % › 60')).toBeInTheDocument();
    expect(
      screen.getByText(`since ${clock(NOW.minus({ hours: 2, minutes: 20 }))} · for 2 h · repeats every 30 min until resolved`),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open timeline' })).toHaveAttribute('href', '/spaces/space-1/timeline');
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/spaces/space-1/control/alarms?rule=rule-1');
  });

  it('names the output for a rule that watches one, and only the kind once the rule is gone', async () => {
    server.alerts = [alert({ id: 'running', ruleId: 'rule-2', value: null }), alert({ id: 'orphan', ruleId: 'rule-gone' })];
    server.rules = [rule({ id: 'rule-2', watch: { kind: 'output_running', output: 'dehumidifier' }, forSeconds: 7200, repeatSeconds: 0 })];
    draw();

    expect(await screen.findByText('Flower room B · dehumidifier running non-stop › 2 h')).toBeInTheDocument();
    expect(screen.getByText(/says it once$/)).toBeInTheDocument();
    expect(screen.getByText('Flower room B · alarm · 68')).toBeInTheDocument();
  });

  it('names the camera for a stale one and offers a look rather than a silence', async () => {
    server.alerts = [
      alert({ id: 'cam', kind: 'camera_stale', ruleId: null, deviceId: null, spaceId: null, cameraId: 'cam-2', severity: 'info', value: null }),
    ];
    draw();

    expect(await screen.findByText(`Cam 2 · no image since ${clock(NOW.minus({ hours: 2, minutes: 20 }))}`)).toBeInTheDocument();
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

    expect(await screen.findByText(new RegExp(`silenced until ${clock(NOW.plus({ minutes: 40 }))}$`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unsilence' }));

    await waitFor(() => expect(sentTo('DELETE', '/v1/alarm-rules/rule-1/silence')).toHaveLength(1));
  });

  it('asks the device for a quarter of an hour of maintenance', async () => {
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Maintenance 15 min' }));

    await waitFor(() => expect(sentTo('POST', '/v1/devices/device-1/commands')).toHaveLength(1));
    expect(sentTo('POST', '/v1/devices/device-1/commands')[0].body).toEqual({ kind: 'maintenance', forSeconds: 900 });
    expect(await screen.findByRole('status')).toHaveTextContent('Asked.');
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

    expect(await screen.findByText(`Muted until ${clock(until)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await waitFor(() => expect(sentTo('PATCH', '/v1/me')).toHaveLength(2));
    expect((sentTo('PATCH', '/v1/me')[1].body as Me).notifications.mutedUntil).toBeNull();
  });

  it('offers nothing that writes to somebody who may only look', async () => {
    state.who = 'demo';
    server.alerts = [alert({})];
    server.rules = [rule()];
    draw();

    expect(await screen.findByText('Flower room B · RH 68 % › 60')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open timeline' })).not.toBeInTheDocument();
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

  it('keeps an open alert under NOW however long ago it began', () => {
    const groups = groupsOf([alert({ startedAt: iso(NOW.minus({ days: 3 })) }), alert({ id: 'r', resolvedAt: iso(NOW) })], NOW);

    expect(groups.map(group => group.heading.kind)).toEqual(['now', 'earlierToday']);
  });
});
