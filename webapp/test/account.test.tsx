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
import type { Me, Media, PasswordChange, Session } from '@fg2/shared-types/v1';
import { Account } from '@/screens/me/account/Account';
import { deviceLabel, sortedSessions } from '@/screens/me/account/sessions';

/**
 * Me › Account: the address, the password, the sessions, the export and the
 * way out.
 *
 * The password is checked on the wire - that both the current and the new one
 * travel, and that a wrong current one is said under the form and ends
 * nothing. The sessions are checked for the one row that must not carry a
 * Sign out, and the export for being the same job as a grow's: asked once,
 * polled by its media row, offered as a file once it is ready.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    // A test session carries no media token, and a picture's address without one is nothing; the file link only needs an address.
    mediaUrl: (id: string) => `/media/${id}/content`,
    useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN),
  };
});

const me = (): Me => ({
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
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
});

const at = (id: string, userAgent: string | null, lastSeenAt: string): Session => ({
  id,
  createdAt: lastSeenAt,
  userId: 'user-1',
  userAgent,
  lastSeenAt,
  expiresAt: '2026-10-22T12:00:00.000Z',
});

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// `session-1` is the id the test session carries, so it is this device.
const SESSIONS = [
  at('session-2', MAC_CHROME, '2026-09-22T11:00:00.000Z'),
  at('session-1', IPHONE_SAFARI, '2026-09-22T09:00:00.000Z'),
  at('session-3', 'curl/8.7.1', '2026-09-22T10:00:00.000Z'),
];

const exportRow = (status: 'queued' | 'ready'): Media =>
  ({
    id: 'media-export',
    kind: 'export',
    mime: 'application/zip',
    bytes: 13_000_000,
    exportJob: { status, scope: 'account', growId: null, startedAt: null, endedAt: status === 'ready' ? server.builtAt : null, error: null },
  }) as unknown as Media;

const server = {
  me: me(),
  sessions: SESSIONS,
  wrongPassword: false,
  passwords: [] as PasswordChange[],
  revoked: [] as string[],
  sweptOthers: 0,
  exportsAsked: 0,
  mediaAsked: 0,
  /** When the server says the zip was written. The route hands back a standing export for an hour, so this is not always now. */
  builtAt: null as string | null,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';

  if (pathname === '/v1/me' && method === 'GET') return json(server.me);
  if (pathname === '/v1/me/password' && method === 'PUT') {
    server.passwords.push(JSON.parse(String(init?.body)) as PasswordChange);
    if (server.wrongPassword) {
      return json(
        { status: 401, code: 'current_password_wrong', title: 'Unauthorized', detail: 'That is not this account´s current password.', errors: [] },
        401,
      );
    }
    return new Response(null, { status: 204 });
  }
  if (pathname === '/v1/sessions' && method === 'GET') return json({ items: server.sessions, nextCursor: null });
  if (pathname === '/v1/sessions' && method === 'DELETE') {
    server.sweptOthers += 1;
    server.sessions = server.sessions.filter(row => row.id === 'session-1');
    return new Response(null, { status: 204 });
  }
  if (pathname.startsWith('/v1/sessions/') && method === 'DELETE') {
    const id = pathname.slice('/v1/sessions/'.length);
    server.revoked.push(id);
    server.sessions = server.sessions.filter(row => row.id !== id);
    return new Response(null, { status: 204 });
  }
  if (pathname === '/v1/me/export' && method === 'GET') {
    server.exportsAsked += 1;
    return json({ media: exportRow('queued'), queued: true }, 202);
  }
  if (pathname === '/v1/media/media-export' && method === 'GET') {
    server.mediaAsked += 1;
    return json(exportRow('ready'));
  }
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const drawIn = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/me/account']}>
        <Account />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const draw = () => drawIn(freshClient());

const drawLoaded = async () => {
  draw();
  await screen.findByText('login@example.org');
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.me = me();
  server.sessions = SESSIONS;
  server.wrongPassword = false;
  server.passwords = [];
  server.revoked = [];
  server.sweptOthers = 0;
  server.exportsAsked = 0;
  server.mediaAsked = 0;
  server.builtAt = null;
});

afterEach(() => vi.unstubAllGlobals());

describe('how this person signs in', () => {
  it('shows the address and says it cannot be changed here, rather than offering a field the server has no route for', async () => {
    await drawLoaded();

    expect(screen.getByText(/this server offers no way to change it/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /e-mail/i })).not.toBeInTheDocument();
  });

  it('changes the password with the current one in hand, and says so once it is done', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-one' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'new-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.passwords).toEqual([{ currentPassword: 'old-one', newPassword: 'new-one' }]));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  it('will not send two new passwords that differ', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-one' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'new-two' } });

    expect(screen.getByText('The two new passwords differ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(server.passwords).toEqual([]);
  });

  it('says under the form when the current password was wrong, and keeps the form open', async () => {
    server.wrongPassword = true;
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'guess' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'new-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That is not this account´s current password.');
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });
});

describe('where this person is signed in', () => {
  it('lists every session with this device first and without a way to end it by accident', async () => {
    await drawLoaded();

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Safari · iOS'),
      expect.stringContaining('Chrome · macOS'),
      expect.stringContaining('curl'),
    ]);
    expect(within(rows[0]).getByText('this device')).toBeInTheDocument();
    expect(within(rows[0]).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('ends another session and reads the list again', async () => {
    await drawLoaded();

    const rows = await screen.findAllByRole('listitem');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(server.revoked).toEqual(['session-2']));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  });

  it('signs every other browser out in one act, and keeps this one', async () => {
    await drawLoaded();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign every other browser out' }));

    await waitFor(() => expect(server.sweptOthers).toBe(1));
    // The list is read again, and what is left is the browser doing the asking.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('this device')).toBeInTheDocument();
  });

  it('offers no sweep to somebody signed in nowhere else', async () => {
    server.sessions = server.sessions.slice(0, 1);
    await drawLoaded();

    expect(screen.queryByRole('button', { name: 'Sign every other browser out' })).not.toBeInTheDocument();
  });

  it('reads a browser off its user agent and repeats what it cannot read', () => {
    expect(deviceLabel(MAC_CHROME)).toBe('Chrome · macOS');
    expect(deviceLabel(IPHONE_SAFARI)).toBe('Safari · iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox · Windows');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0')).toBe(
      'Edge · Linux',
    );
    expect(deviceLabel('curl/8.7.1')).toBe('curl');
    expect(deviceLabel('critic')).toBe('critic');
    expect(deviceLabel(null)).toBeNull();
  });

  /**
   * Every agent run and every script signs in, so this list grows without
   * anybody browsing it, and under it stand the export and the deletion, which
   * are what somebody came to this page for. A ceiling keeps them in reach; the
   * rest is one tap away and nothing about it is hidden.
   */
  it('draws a handful of sessions and offers the rest', async () => {
    server.sessions = [
      at('session-1', IPHONE_SAFARI, '2026-09-22T09:00:00.000Z'),
      ...Array.from({ length: 12 }, (_, index) => at(`bulk-${index}`, MAC_CHROME, `2026-09-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`)),
    ];
    await drawLoaded();

    expect(await screen.findByText('this device')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'Show the rest' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(13);
    expect(screen.queryByRole('button', { name: 'Show the rest' })).not.toBeInTheDocument();
  });

  it('puts this device first and the rest by when they were last used', () => {
    expect(sortedSessions(SESSIONS, 'session-1').map(row => row.id)).toEqual(['session-1', 'session-2', 'session-3']);
    expect(sortedSessions(SESSIONS, null).map(row => row.id)).toEqual(['session-2', 'session-3', 'session-1']);
  });
});

describe('taking everything away', () => {
  it('asks for the export once, follows the job by its media row, and offers the file when it is ready', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    expect(await screen.findByRole('link', { name: /Download · 12\.4 MB/ })).toHaveAttribute('href', '/media/media-export/content');
    expect(server.exportsAsked).toBe(1);
    expect(server.mediaAsked).toBeGreaterThan(0);
  });

  /**
   * A zip of a season does not finish while somebody stands and watches it, so
   * the job's id is kept where leaving the page cannot lose it. Coming back to
   * a button offering to build what the server has already built is how the
   * finished file was orphaned and the wait started again.
   */
  it('finds the finished file again after a walk to another screen and back', async () => {
    const client = freshClient();
    const first = drawIn(client);
    await screen.findByText('login@example.org');

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));
    expect(await screen.findByRole('link', { name: /Download · 12\.4 MB/ })).toBeInTheDocument();

    first.unmount();
    drawIn(client);

    expect(await screen.findByRole('link', { name: /Download · 12\.4 MB/ })).toHaveAttribute('href', '/media/media-export/content');
    expect(screen.queryByRole('button', { name: 'Build the zip' })).not.toBeInTheDocument();
    expect(server.exportsAsked).toBe(1);
  });

  it('dates the file it hands over, because the route answers a standing one for an hour', async () => {
    server.builtAt = DateTime.now().minus({ minutes: 40 }).toISO();
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    expect(await screen.findByRole('link', { name: /Download · 12\.4 MB · built 40 min ago/ })).toBeInTheDocument();
  });

  it('carries the same door to deleting the account that the privacy page has', async () => {
    await drawLoaded();

    expect(screen.getByText('Delete my account')).toBeInTheDocument();
    expect(screen.getByText('really deleted, not hidden · devices stay claimable')).toBeInTheDocument();
  });

  /**
   * The prompt is drawn in the small caps this app labels with, so a handle of
   * `you` is read as YOU and that is what gets typed; a phone capitalises the
   * first letter of it anyway. The sheet has to take what it asked for, and to
   * say so when what was typed is something else instead of leaving a grey
   * button and no reason.
   */
  it('takes the handle as the sheet prints it, whatever the keyboard did to the case', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete my account' });
    const field = screen.getByLabelText('Type you to confirm');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: 'yo' } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('That is not your handle.')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'YOU' } });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText('That is not your handle.')).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: ' @You ' } });
    expect(confirm).toBeEnabled();
  });
});

describe('the demo', () => {
  it('is told there is no account rather than shown a page the server would refuse', () => {
    session.demo = true;
    draw();

    expect(screen.getByText('The demo has no account of its own, so there is nothing here to settle.')).toBeInTheDocument();
    expect(fetchStub.mock.calls.filter(([input]) => String(input).includes('/v1/'))).toHaveLength(0);
  });
});
