import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate, NotificationRouting, NotificationSettings, Problem } from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { Notifications } from '@/screens/notifications/Notifications';
import { headersOf, headersText, minuteOf, routingWith, timeOf } from '@/screens/notifications/settings';

/**
 * Where notifications go, and what one switch sends.
 *
 * The settings travel whole - `PATCH /me` replaces the object - so the thing
 * to check about every switch is not only the cell it moved but that every
 * other cell went back exactly as it was read. The fetch is stubbed by route
 * so that the body on the wire is what is asserted, not what a hook was asked.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const NOTHING: NotificationSettings = {
  channels: { email: null, telegram: null, webhook: null },
  routing: { alerts: [], warnings: [], tasks: [], plan: [], weekly_timelapse: [] },
  quietHours: null,
  mutedUntil: null,
};

const me = (notifications: Partial<NotificationSettings> = {}, over: Partial<Me> = {}): Me => ({
  id: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'login@example.org',
  isAdmin: false,
  isActive: true,
  handle: 'you',
  bio: null,
  avatarMediaId: null,
  publicProfile: false,
  privacy: { hideWeights: false, hideCounts: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  retention: { climateDays: null },
  notifications: { ...NOTHING, ...notifications },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null },
  pushPublicKey: 'BAbC',
  telegramAvailable: true,
  pushSubscribed: false,
  ...over,
});

/** The account the server answers, and what it says to a change. */
const server = { me: me(), refuse: null as Problem | null, patched: [] as MeUpdate[], posted: [] as string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';

  if (url.endsWith('/v1/me') && method === 'GET') return json(server.me);
  if (url.endsWith('/v1/me') && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    if (server.refuse) return json(server.refuse, server.refuse.status);
    server.me = { ...server.me, ...body } as Me;
    return json(server.me);
  }
  if (url.endsWith('/v1/me/telegram-link') && method === 'POST') {
    server.posted.push(url);
    return json({ url: 'https://t.me/terpbot?start=abc', validUntil: DateTime.now().plus({ minutes: 15 }).toISO() }, 201);
  }
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/notifications']}>
        <LogProvider>
          <Notifications />
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The screen once the account has arrived. */
const drawLoaded = async () => {
  draw();
  await screen.findByRole('switch', { name: 'Push' });
};

const lastPatch = (): NotificationSettings => server.patched.at(-1)!.notifications!;

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.me = me();
  server.refuse = null;
  server.patched = [];
  server.posted = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('an account with nothing configured', () => {
  it('says every channel is off and offers no routing to any of them', async () => {
    await drawLoaded();

    expect(screen.getAllByText('off · not configured')).toHaveLength(2);
    expect(screen.getByText('off · not linked')).toBeInTheDocument();
    for (const name of ['Telegram', 'E-mail', 'Webhook']) expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
    for (const cell of screen.getAllByRole('switch', { name: / by / })) expect(cell).toBeDisabled();
    expect(screen.getByText(/A channel is off until it is configured, and its column/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
  });

  it('cannot offer push where the install has no key, and says so', async () => {
    server.me = me({}, { pushPublicKey: null });
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Push' })).toBeDisabled();
    expect(screen.getByText('this install has no push key')).toBeInTheDocument();
  });

  it('cannot offer Telegram where the install runs no bot', async () => {
    server.me = me({}, { telegramAvailable: false });
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Telegram' })).toBeDisabled();
    expect(screen.getByText('this install has no Telegram bot')).toBeInTheDocument();
  });
});

describe('an account with an address', () => {
  const WITH_MAIL: Partial<NotificationSettings> = {
    channels: { email: 'you@example.org', telegram: null, webhook: null },
    routing: { alerts: ['email'], warnings: [], tasks: ['email'], plan: [], weekly_timelapse: [] },
  };

  it('shows the address and what the grid sends to it', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    expect(screen.getByText('you@example.org · critical and tasks due')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'E-mail' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Critical alarms by E-mail' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Warnings by E-mail' })).toHaveAttribute('aria-checked', 'false');
  });

  it('routes one more category to it and sends everything else back unchanged', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Warnings by E-mail' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch()).toEqual({
      ...NOTHING,
      ...WITH_MAIL,
      routing: { alerts: ['email'], warnings: ['email'], tasks: ['email'], plan: [], weekly_timelapse: [] },
    });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Warnings by E-mail' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the columns of the channels that are not configured disabled', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Critical alarms by E-mail' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Critical alarms by Telegram' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Critical alarms by Webhook' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Critical alarms by Push' })).toBeDisabled();
  });

  it('switches e-mail off by writing null, and leaves the routing as it was', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'E-mail' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().channels).toEqual({ email: null, telegram: null, webhook: null });
    expect(lastPatch().routing).toEqual(WITH_MAIL.routing);
  });

  it('shows the refusal under the card that asked', async () => {
    server.me = me(WITH_MAIL);
    server.refuse = { status: 422, code: 'invalid_body', title: 'Invalid', detail: 'That address cannot be delivered to.', errors: [] };
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'E-mail' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That address cannot be delivered to.');
    expect(screen.getByRole('switch', { name: 'E-mail' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('quiet hours', () => {
  it('start at the window the board draws, written as minutes from midnight', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().quietHours).toEqual({ fromMinute: 1380, toMinute: 420 });
    expect(await screen.findByText('23:00 – 07:00')).toBeInTheDocument();
    expect(screen.getByText(/critical still comes through/)).toBeInTheDocument();
    expect(screen.getByText('in your time zone (Europe/Berlin)')).toBeInTheDocument();
  });

  it('take a new end from the time field', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06:30' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().quietHours).toEqual({ fromMinute: 1380, toMinute: 390 });
  });

  it('are switched off by writing null', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().quietHours).toBeNull();
  });
});

describe('the mute', () => {
  it('is said at the top while it lasts, and taken off with one write', async () => {
    server.me = me({ mutedUntil: DateTime.now().plus({ hours: 2 }).toISO()! });
    await drawLoaded();

    expect(screen.getByRole('status')).toHaveTextContent(/^Muted until /);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().mutedUntil).toBeNull();
  });

  it('is not mentioned once it is over', async () => {
    server.me = me({ mutedUntil: DateTime.now().minus({ hours: 2 }).toISO()! });
    await drawLoaded();

    expect(screen.queryByText(/Muted until/)).not.toBeInTheDocument();
  });
});

describe('linking Telegram', () => {
  it('asks the server for a link and offers it to open in Telegram', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Telegram' }));

    const open = await screen.findByRole('link', { name: 'Open Telegram' });
    expect(server.posted).toHaveLength(1);
    expect(open).toHaveAttribute('href', 'https://t.me/terpbot?start=abc');
    expect(open).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/^valid until /)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Telegram' })).toHaveAttribute('aria-checked', 'true');
    expect(server.patched).toHaveLength(0);
  });

  it('asks before unlinking a chat, and only then writes null', async () => {
    server.me = me({ channels: { email: null, telegram: { chatId: '42', linkedAt: '2026-09-01T10:00:00.000Z' }, webhook: null } });
    await drawLoaded();

    expect(screen.getByText(/^linked .* · alarms, weekly recap, log by replying$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Telegram' }));
    expect(server.patched).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().channels.telegram).toBeNull();
  });
});

describe('the webhook', () => {
  it('is saved with its host on the card and its headers as lines', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Webhook' }));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://ha.local/api/webhook/terp' } });
    fireEvent.click(screen.getByRole('button', { name: 'PUT' }));
    fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'Authorization: Bearer x\nnot a header' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().channels.webhook).toEqual({ url: 'https://ha.local/api/webhook/terp', method: 'PUT', headers: { Authorization: 'Bearer x' } });
    expect(await screen.findByText('ha.local · JSON')).toBeInTheDocument();
  });
});

describe('the demo', () => {
  it('sees every setting and can move none of them', async () => {
    session.demo = true;
    server.me = me({ channels: { email: 'you@example.org', telegram: null, webhook: null }, routing: { ...NOTHING.routing, alerts: ['email'] } });
    await drawLoaded();

    expect(screen.getByText('you@example.org · critical')).toBeInTheDocument();
    for (const one of screen.getAllByRole('switch')) expect(one).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('the arithmetic', () => {
  it('flips one cell and leaves a channel that is already there once', () => {
    const routing: NotificationRouting = { alerts: ['email'], warnings: [] };

    expect(routingWith(routing, 'alerts', 'email', true)).toEqual(routing);
    expect(routingWith(routing, 'alerts', 'push', true)).toEqual({ alerts: ['email', 'push'], warnings: [] });
    expect(routingWith(routing, 'alerts', 'email', false)).toEqual({ alerts: [], warnings: [] });
    expect(routingWith(routing, 'tasks', 'push', true)).toEqual({ alerts: ['email'], warnings: [], tasks: ['push'] });
  });

  it('turns clock times into minutes from midnight and back', () => {
    expect(minuteOf('23:00')).toBe(1380);
    expect(minuteOf('07:00')).toBe(420);
    expect(minuteOf('')).toBeNull();
    expect(timeOf(1380)).toBe('23:00');
    expect(timeOf(5)).toBe('00:05');
  });

  it('reads headers as lines and drops what is not one', () => {
    expect(headersOf('Authorization: Bearer x\n\nX-Empty:\nnonsense\n: no name')).toEqual({ Authorization: 'Bearer x', 'X-Empty': '' });
    expect(headersText({ A: '1', B: '2' })).toBe('A: 1\nB: 2');
  });
});
