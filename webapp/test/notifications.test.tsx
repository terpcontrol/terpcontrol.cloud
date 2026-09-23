import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate, NotificationRouting, NotificationSettings, Problem } from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { Me as MeScreen } from '@/screens/Me';
import { Notifications } from '@/screens/notifications/Notifications';
import { pathOf, payloadOf } from '@/screens/notifications/push-route';
import { minuteOf, routingWith, timeOf } from '@/screens/notifications/settings';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { headersOf, headersText } from '@/ui/headers';

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
  climateRetention: { installDays: null, appliesDays: null },
  notifications: { ...NOTHING, ...notifications },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: 'BAbC',
  telegramAvailable: true,
  pushSubscribed: false,
  ...over,
});

/** The account the server answers, and what it says to a change. `hold` keeps a write on the wire until a test lets it land. */
const server = { me: me(), refuse: null as Problem | null, patched: [] as MeUpdate[], posted: [] as string[], hold: null as Promise<void> | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';

  if (url.endsWith('/v1/me') && method === 'GET') return json(server.me);
  if (url.endsWith('/v1/me') && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    if (server.hold) await server.hold;
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

const wrapped = (screenUnderTest: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/notifications']}>
        <LogProvider>{screenUnderTest}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const draw = () => wrapped(<Notifications />);

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
  server.hold = null;
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

  it('keeps the card to its line until Edit is tapped, and only saves a changed address', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Address')).toHaveValue('you@example.org');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'other@example.org' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().channels.email).toBe('other@example.org');
    await waitFor(() => expect(screen.queryByLabelText('Address')).not.toBeInTheDocument());
  });

  it('closes the field again when the change is taken back', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'typo@example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument();
    expect(server.patched).toHaveLength(0);
    expect(screen.getByText('you@example.org · critical and tasks due')).toBeInTheDocument();
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

  it('draws a cell of a channel that can deliver nothing as off, keeps the routing, and says it is kept', async () => {
    server.me = me({ ...WITH_MAIL, routing: { alerts: ['email', 'push'], warnings: [], tasks: ['email'], plan: [], weekly_timelapse: [] } });
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Critical alarms by Push' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/That routing is kept/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Warnings by E-mail' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().routing.alerts).toEqual(['email', 'push']);
  });

  it('says nothing about kept routing where every routed channel can deliver', async () => {
    server.me = me(WITH_MAIL);
    await drawLoaded();

    expect(screen.queryByText(/That routing is kept/)).not.toBeInTheDocument();
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

  it('say Off as the card of every other channel says its name', async () => {
    await drawLoaded();

    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('take a new end from the time field', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06:30' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().quietHours).toEqual({ fromMinute: 1380, toMinute: 390 });
  });

  it('write nothing while a time is being typed, and the whole time once the field is left', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    const from = screen.getByLabelText('From');
    from.focus();
    // A time field hands over a whole time after every keystroke: the "2" of 23:00 arrives as 02:00.
    fireEvent.change(from, { target: { value: '02:00' } });
    fireEvent.change(from, { target: { value: '22:00' } });
    expect(server.patched).toHaveLength(0);
    expect(from).toBeEnabled();

    fireEvent.change(from, { target: { value: '22:30' } });
    fireEvent.blur(from);

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().quietHours).toEqual({ fromMinute: 1350, toMinute: 420 });
  });

  it('lose neither end when both are moved before the first write has landed', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    let land = () => {};
    server.hold = new Promise<void>(resolve => (land = resolve));

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '22:00' } });
    await waitFor(() => expect(server.patched).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06:30' } });
    await waitFor(() => expect(server.patched).toHaveLength(2));

    // The second write carries the end the first one moved, rather than the one the account still says.
    expect(server.patched[1].notifications!.quietHours).toEqual({ fromMinute: 1320, toMinute: 390 });

    server.hold = null;
    land();

    await waitFor(() => expect(lastPatch().quietHours).toEqual({ fromMinute: 1320, toMinute: 390 }));
    expect(screen.getByLabelText('From')).toHaveValue('22:00');
    expect(screen.getByLabelText('To')).toHaveValue('06:30');
  });

  it('leave a field that was emptied saying what is stored', async () => {
    server.me = me({ quietHours: { fromMinute: 1380, toMinute: 420 } });
    await drawLoaded();

    const to = screen.getByLabelText('To');
    to.focus();
    fireEvent.change(to, { target: { value: '' } });
    fireEvent.blur(to);

    expect(server.patched).toHaveLength(0);
    expect(to).toHaveValue('07:00');
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

    expect(screen.getByRole('status')).toHaveTextContent(/^Your channels are muted until /);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().mutedUntil).toBeNull();
  });

  /**
   * The alerts inbox said "muted until 11:38" while this screen said "11:38
   * AM" about the same instant, because a locale preset follows the app's
   * language and not the account's zone.
   */
  it('names the hour it runs to the way the rest of the app names one', async () => {
    // Read where the account is kept, both ends of it, so that the two hours
    // compared here are the two hours the screen compared.
    const until = DateTime.now().plus({ hours: 2 }).setZone('Europe/Berlin');
    const today = until.hasSame(DateTime.now().setZone('Europe/Berlin'), 'day');
    server.me = me({ mutedUntil: until.toISO()! });
    await drawLoaded();

    expect(screen.getByRole('status')).toHaveTextContent(`Your channels are muted until ${until.toFormat(today ? 'HH:mm' : 'd MMM HH:mm')}`);
  });

  it('keeps the day on a mute that runs past midnight, which a bare hour would read as already past', async () => {
    const until = DateTime.now().plus({ days: 1, hours: 2 });
    server.me = me({ mutedUntil: until.toISO()! });
    await drawLoaded();

    expect(screen.getByRole('status')).toHaveTextContent(`Your channels are muted until ${until.setZone('Europe/Berlin').toFormat('d MMM HH:mm')}`);
  });

  it('is not mentioned once it is over', async () => {
    server.me = me({ mutedUntil: DateTime.now().minus({ hours: 2 }).toISO()! });
    await drawLoaded();

    expect(screen.queryByText(/muted until/)).not.toBeInTheDocument();
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
  it('is told there are no settings rather than shown a retry the server would refuse', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no account settings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(fetchStub.mock.calls.filter(([input]) => String(input).endsWith('/v1/me'))).toHaveLength(0);
  });

  it('is not offered the door to them on Me either', () => {
    session.demo = true;
    wrapped(
      <ThemeProvider>
        <MeScreen />
      </ThemeProvider>,
    );

    expect(screen.queryByRole('link', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.getByText('The demo has no account settings.')).toBeInTheDocument();
  });
});

describe('the push card', () => {
  /**
   * jsdom is a browser without a push service, which the card would say
   * instead of anything about the account. This is the least that makes it a
   * browser that could be subscribed but is not.
   */
  beforeEach(() => {
    vi.stubGlobal('Notification', { permission: 'default' });
    vi.stubGlobal('PushManager', class {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }) },
    });
  });

  afterEach(() => Reflect.deleteProperty(navigator, 'serviceWorker'));

  it('says the account is pushed to elsewhere when this browser is not the one subscribed', async () => {
    server.me = me({ routing: { ...NOTHING.routing, alerts: ['push'] } }, { pushSubscribed: true });
    await drawLoaded();

    expect(screen.getByText('subscribed on another device · critical')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Push' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Critical alarms by Push' })).toBeEnabled();
  });

  it('is off when no browser of the account is subscribed, and its column with it', async () => {
    await drawLoaded();

    expect(screen.getByText('off · this browser is not subscribed')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Critical alarms by Push' })).toBeDisabled();
  });
});

describe('where a tap on a push lands', () => {
  it('opens the inbox for an alarm, the Tasks tab for a task and for a waiting plan, and the home for anything else', () => {
    expect(pathOf({ subject: { type: 'alert', id: 'alert-1' } })).toBe('/alerts');
    expect(pathOf({ subject: { type: 'task', id: 'task-1' } })).toBe('/tasks');
    // A plan standing still is a task on that tab and can be answered nowhere else.
    expect(pathOf({ subject: { type: 'plan', id: 'plan-1' } })).toBe('/tasks');
    expect(pathOf({})).toBe('/');
  });

  it('opens a week´s film on the camera that shot it, and the home where the push does not say which', () => {
    expect(pathOf({ subject: { type: 'media', id: 'media-1' }, cameraId: 'camera-1' })).toBe('/cameras/camera-1?film=media-1');
    expect(pathOf({ subject: { type: 'media', id: 'media-1' } })).toBe('/');
  });

  it('reads the body the server sent, and a body that is not one as an empty push', () => {
    const payload = {
      title: 'Humidity into mould',
      body: '80 % RH',
      category: 'alerts',
      subject: { type: 'alert', id: 'alert-1' },
      severity: 'critical',
    };

    expect(payloadOf({ json: () => payload })).toEqual(payload);
    expect(
      payloadOf({
        json: () => {
          throw new SyntaxError('not JSON');
        },
      }),
    ).toEqual({});
    expect(payloadOf(null)).toEqual({});
    expect(payloadOf({ json: () => null })).toEqual({});
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
