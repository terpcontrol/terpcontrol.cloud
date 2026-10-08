import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate, NotificationChannels, NotificationRouting, NotificationSettings, Problem } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { LogProvider } from '@/log/LogProvider';
import { Me as MeScreen } from '@/screens/Me';
import { Notifications } from '@/screens/notifications/Notifications';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { pathOf, payloadOf } from '@/screens/notifications/push-route';
import { minuteOf, routingWith, timeOf } from '@/screens/notifications/settings';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { headersOf, headersText } from '@/ui/headers';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { translate } from './translations';

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

const me = (notifications: Partial<NotificationSettings> = {}, over: Partial<Me> = {}): Me =>
  meWith({ notifications: { ...NOTHING, ...notifications }, pushPublicKey: 'BAbC', telegramAvailable: true, ...over });

/** The account the server answers, and what it says to a change. `hold` keeps a write on the wire until a test lets it land. */
const server = {
  me: me(),
  refuse: null as Problem | null,
  patched: [] as MeUpdate[],
  posted: [] as string[],
  hold: null as Promise<void> | null,
  /** The account's cameras, which decide whether the weekly film has a row at all. */
  cameras: [] as { id: string; removedAt: string | null; isDemo: boolean }[],
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';

  if (url.endsWith('/v1/me') && method === 'GET') return json(server.me);
  if (url.endsWith('/v1/me') && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    if (server.hold) await server.hold;
    if (server.refuse) return json(server.refuse, server.refuse.status);
    server.me = { ...server.me, ...body, preferences: { ...server.me.preferences, ...body.preferences } } as Me;
    return json(server.me);
  }
  if (url.endsWith('/v1/me/email-alarms') && method === 'POST') {
    server.posted.push(url);
    if (server.refuse) return json(server.refuse, server.refuse.status);
    const { channels, routing } = server.me.notifications;
    const alerts = routing.alerts ?? [];
    server.me = me({
      ...server.me.notifications,
      channels: { ...channels, email: channels.email ?? server.me.email },
      routing: { ...routing, alerts: alerts.includes('email') ? alerts : [...alerts, 'email'] },
    });
    return json(server.me);
  }
  if (url.endsWith('/v1/cameras') && method === 'GET') return json({ items: server.cameras, nextCursor: null });
  if (url.endsWith('/v1/me/telegram-link') && method === 'POST') {
    server.posted.push(url);
    return json({ url: 'https://t.me/terpbot?start=abc', validUntil: DateTime.now().plus({ minutes: 15 }).toISO() }, 201);
  }
  return json(NOT_FOUND, 404);
});

const wrapped = (screenUnderTest: ReactNode) => drawAt(<LogProvider>{screenUnderTest}</LogProvider>, { at: '/me/notifications' });

const draw = () => wrapped(<Notifications />);

/** The screen once the account has arrived. */
const drawLoaded = async () => {
  draw();
  await screen.findByRole('switch', { name: 'Push' });
};

const lastPatch = (): NotificationSettings => server.patched.at(-1)!.notifications!;

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.me = me();
  server.refuse = null;
  server.patched = [];
  server.posted = [];
  server.hold = null;
  server.cameras = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('an account with nothing configured', () => {
  /**
   * The weekly film is made from a camera's stills. An account without a
   * camera was offered a row of switches for something that could never be
   * sent, as the last line of the grid.
   */
  it('routes the weekly film only for an account that has a camera', async () => {
    const first = draw();
    await screen.findByRole('switch', { name: 'Push' });
    expect(await screen.findByRole('rowheader', { name: 'Critical alarms' })).toBeInTheDocument();
    await expect(screen.findByRole('rowheader', { name: 'Week film' }, { timeout: 400 })).rejects.toThrow();
    first.unmount();

    server.cameras = [{ id: 'camera-1', removedAt: null, isDemo: false }];
    await drawLoaded();
    expect(await screen.findByRole('rowheader', { name: 'Week film' })).toBeInTheDocument();
  });

  /** Due tasks are the diary's reminders; an account that keeps no diary has nothing that could fall due. */
  it('routes due tasks only for an account that keeps a diary, and the plan´s questions either way', async () => {
    server.me = me({}, { layers: { diary: false } });
    const first = draw();
    expect(await screen.findByRole('rowheader', { name: 'Critical alarms' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Plan asks' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Tasks due' })).not.toBeInTheDocument();
    first.unmount();

    server.me = me();
    await drawLoaded();
    expect(await screen.findByRole('rowheader', { name: 'Tasks due' })).toBeInTheDocument();
  });

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
    expect(screen.getByText('not available on this server')).toBeInTheDocument();
  });

  it('cannot offer Telegram where the install runs no bot', async () => {
    server.me = me({}, { telegramAvailable: false });
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Telegram' })).toBeDisabled();
    expect(screen.getByText('not available on this server')).toBeInTheDocument();
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

describe('the address field', () => {
  it('starts on the address the account signs in with, and saving that first address carries critical alarms with it', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'E-mail' }));
    expect(screen.getByLabelText('Address')).toHaveValue('login@example.org');
    expect(server.patched).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().channels.email).toBe('login@example.org');
    expect(lastPatch().routing).toEqual({ ...NOTHING.routing, alerts: ['email'] });
  });

  it('routes nothing more where critical alarms already reach the account another way', async () => {
    const linked = { chatId: '42', linkedAt: '2026-01-02T00:00:00.000Z' };
    server.me = me({ channels: { ...NOTHING.channels, telegram: linked }, routing: { ...NOTHING.routing, alerts: ['telegram'] } });
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'E-mail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(lastPatch().routing.alerts).toEqual(['telegram']);
  });
});

/**
 * Every account starts reached by nothing, the device-offline rule included,
 * and the notice says so where it will be read - with the one tap that mails
 * critical alarms to the login address. The tap carries no address: the server
 * names it, so what is checked on the wire is that nothing else was sent.
 */
describe('the notice that alarms reach nobody', () => {
  /** Says when the account has been read, so that a notice that is not drawn is not merely still waiting for it. */
  function Read() {
    return useMe().data ? <span>read</span> : null;
  }

  const later = () =>
    wrapped(
      <>
        <NotifyNotice later />
        <Read />
      </>,
    );

  it('names the address the tap writes to, mails critical alarms there in one tap, and says so', async () => {
    later();

    expect(await screen.findByText('Alarms do not reach you')).toBeInTheDocument();
    expect(screen.getByText('to login@example.org')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Other ways ›' })).toHaveAttribute('href', '/me/notifications');

    // Over the readings the notice is two rows, so the tap reads "By e-mail" with the address beside it.
    fireEvent.click(screen.getByRole('button', { name: 'By e-mail' }));

    expect(await screen.findByText('Critical alarms now come by e-mail to login@example.org.')).toBeInTheDocument();
    expect(server.posted).toEqual([expect.stringMatching(/\/v1\/me\/email-alarms$/)]);
    expect(server.patched).toHaveLength(0);
  });

  it('offers an address the account already set rather than the login one', async () => {
    server.me = me({ channels: { ...NOTHING.channels, email: 'alarms@example.org' } });
    later();

    expect(await screen.findByText('to alarms@example.org')).toBeInTheDocument();
  });

  it('puts itself away for a week with Later, on the account rather than in this browser', async () => {
    later();

    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    const preferences = server.patched[0].preferences!;
    expect(Object.keys(preferences)).toEqual(['notifyLaterUntil']);
    const days = DateTime.fromISO(preferences.notifyLaterUntil!).diff(DateTime.now(), 'days').days;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(screen.queryByText('Alarms do not reach you')).not.toBeInTheDocument();
  });

  it('stays away while Later holds, and comes back once it has run out', async () => {
    server.me = me({}, { preferences: { ...me().preferences, notifyLaterUntil: DateTime.now().plus({ days: 2 }).toISO() } });
    const { unmount } = later();
    await screen.findByText('read');
    expect(screen.queryByText('Alarms do not reach you')).not.toBeInTheDocument();
    unmount();

    server.me = me({}, { preferences: { ...me().preferences, notifyLaterUntil: DateTime.now().minus({ minutes: 1 }).toISO() } });
    later();
    expect(await screen.findByText('Alarms do not reach you')).toBeInTheDocument();
  });

  it('says nothing where a critical alarm reaches the account, and speaks up where its only channel cannot deliver', async () => {
    server.me = me({ channels: { ...NOTHING.channels, email: 'you@example.org' }, routing: { ...NOTHING.routing, alerts: ['email'] } });
    const { unmount } = later();
    await screen.findByText('read');
    expect(screen.queryByText('Alarms do not reach you')).not.toBeInTheDocument();
    unmount();

    // Push named on the row, but no browser of the account has subscribed.
    server.me = me({ routing: { ...NOTHING.routing, alerts: ['push'] } });
    later();
    expect(await screen.findByText('Alarms do not reach you')).toBeInTheDocument();
  });

  it('stands first on the settings page, where Later is not offered and nothing put away is honoured', async () => {
    server.me = me({}, { preferences: { ...me().preferences, notifyLaterUntil: DateTime.now().plus({ days: 2 }).toISO() } });
    await drawLoaded();

    expect(screen.getByText('Alarms do not reach you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Other ways ›' })).not.toBeInTheDocument();
  });

  it('is not drawn for the demo, which has no account to change', async () => {
    session.demo = true;
    wrapped(<NotifyNotice later />);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('Alarms do not reach you')).not.toBeInTheDocument();
    expect(fetchStub.mock.calls.filter(([input]) => String(input).endsWith('/v1/me'))).toHaveLength(0);
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

  /**
   * What a linked chat is sent is the grid's, not a fixed list: the card named
   * alarms and the weekly recap on an account that routed neither to Telegram.
   * Replying writes to the diary only under an alarm or a task, so that is said
   * only where one of those rows goes there.
   */
  const chat = { chatId: '42', linkedAt: '2026-09-01T10:00:00.000Z' };

  it('says what the grid sends the chat, and that a reply to an alarm is logged', async () => {
    server.me = me({
      channels: { email: null, telegram: chat, webhook: null },
      routing: { alerts: ['telegram'], warnings: [], tasks: [], plan: [], weekly_timelapse: ['telegram'] },
    });
    await drawLoaded();

    expect(screen.getByText(/^linked .* · critical and week film · a reply to an alarm or a task goes into the diary$/)).toBeInTheDocument();
  });

  it('promises no logging by reply where nothing sent there can take one', async () => {
    server.me = me({
      channels: { email: null, telegram: chat, webhook: null },
      routing: { alerts: [], warnings: [], tasks: [], plan: ['telegram'], weekly_timelapse: [] },
    });
    await drawLoaded();

    expect(screen.getByText(/^linked .* · plan asks$/)).toBeInTheDocument();
  });

  it('asks before unlinking a chat, and only then writes null', async () => {
    server.me = me({ channels: { email: null, telegram: { chatId: '42', linkedAt: '2026-09-01T10:00:00.000Z' }, webhook: null } });
    await drawLoaded();

    expect(screen.getByText(/^linked .* · nothing routed here yet$/)).toBeInTheDocument();
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

  /**
   * The row an ordinary grower ends up with: a webhook saved with the Headers
   * box left empty, stored without the key at all, and read back as a webhook
   * whose headers are nothing. The screen has to draw over it, because it is
   * the whole of what the account can reach - the channels, the routing grid,
   * quiet hours and the mute line are one screen, and the switch that turns
   * this webhook off again is on it, so a screen that will not draw is an
   * account that cannot undo what it saved.
   */
  it('draws over a stored webhook whose headers the database dropped', async () => {
    const headerless = { url: 'https://ha.local/api/webhook/terp', method: 'POST' } as NotificationChannels['webhook'];
    server.me = me({ channels: { email: null, telegram: null, webhook: headerless } });
    await drawLoaded();

    expect(screen.getByText('ha.local · JSON')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Headers')).toHaveValue('');
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
