import { type QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate, Media, PasswordChange, Session } from '@fg2/shared-types/v1';
import { session as store } from '@/api/session';
import type { Told } from '@/log/log-context';
import { fileSize } from '@/ui/figures';
import { Account } from '@/screens/me/account/Account';
import { deviceLabel, sortedSessions } from '@/screens/me/account/sessions';
import { drawAt, json, NOT_FOUND, reading } from './harness';
import { meWith } from './session';
import { Toast } from './toast';
import { catalogue, translate } from './translations';

/**
 * Me › Account: the address, the password, the time zone, the sessions, the
 * export and the way out.
 *
 * The password is checked on the wire - that both the current and the new one
 * travel, and that a wrong current one is said at its field and ends
 * nothing. The zone is checked for travelling alone, and for the toast that
 * takes it back. The sessions are checked for the one row that must not carry
 * a Sign out, and the export for being the same job as a grow's: asked once,
 * polled by its media row, offered as a file once it is ready. What landed is
 * said in a toast, so the page is drawn with one.
 */

const session = vi.hoisted(() => ({ demo: false }));

/** The zone this browser is in, which is not the test machine's to decide. */
const device = vi.hoisted(() => ({ zone: 'Europe/Berlin' }));

vi.mock('@/ui/zone', async importOriginal => ({ ...(await importOriginal<object>()), browserZone: () => device.zone }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    // A test session carries no media token, and a picture's address without one is nothing; the file link only needs an address.
    mediaUrl: (id: string) => `/media/${id}/content`,
    useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN),
  };
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
    bytes: server.exportBytes,
    createdAt: server.builtAt ?? DateTime.now().toISO(),
    exportJob: { status, scope: 'account', growId: null, startedAt: null, endedAt: status === 'ready' ? server.builtAt : null, error: null },
  }) as unknown as Media;

const server = {
  me: meWith(),
  sessions: SESSIONS,
  wrongPassword: false,
  passwords: [] as PasswordChange[],
  patched: [] as MeUpdate[],
  deleted: 0,
  revoked: [] as string[],
  sweptOthers: 0,
  exportsAsked: 0,
  mediaAsked: 0,
  /** What the finished zip weighs. An account's is the one file in this app that reaches a gigabyte. */
  exportBytes: 13_000_000,
  /** When the server says the zip was written. The route hands back a standing export for an hour, so this is not always now. */
  builtAt: null as string | null,
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';

  if (pathname === '/v1/me' && method === 'GET') return json(server.me);
  if (pathname === '/v1/me' && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    server.me = { ...server.me, ...body, preferences: { ...server.me.preferences, ...body.preferences } } as Me;
    return json(server.me);
  }
  if (pathname === '/v1/me' && method === 'DELETE') {
    server.deleted += 1;
    return new Response(null, { status: 204 });
  }
  if (pathname === '/v1/me/password' && method === 'PUT') {
    server.passwords.push(JSON.parse(String(init?.body)) as PasswordChange);
    if (server.wrongPassword) {
      return json(
        { status: 401, code: 'current_password_wrong', title: 'Unauthorized', detail: "That is not this account's current password.", errors: [] },
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
  return json(NOT_FOUND, 404);
});

const told: Told[] = [];

const draw = (client?: QueryClient) =>
  drawAt(
    <Toast told={told}>
      <Account />
    </Toast>,
    { at: '/me/account', client },
  );

const drawLoaded = async () => {
  draw();
  await screen.findByText('login@example.org');
};

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  device.zone = 'Europe/Berlin';
  told.length = 0;
  server.me = meWith();
  server.sessions = SESSIONS;
  server.wrongPassword = false;
  server.passwords = [];
  server.patched = [];
  server.deleted = 0;
  server.revoked = [];
  server.sweptOthers = 0;
  server.exportsAsked = 0;
  server.mediaAsked = 0;
  server.exportBytes = 13_000_000;
  server.builtAt = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The export a browser keeps by account would be the next test's standing file.
  localStorage.clear();
});

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
    // Said in the toast, with no way back: the old password is not the app's to put back.
    await waitFor(() => expect(told).toEqual([{ label: 'Password changed.', undo: null }]));
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

  it('says at its field that the current password was wrong, in the reader’s language, and keeps the form open', async () => {
    server.wrongPassword = true;
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'guess' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'new-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const said = await screen.findByRole('alert');
    expect(said).toHaveTextContent("That is not this account's current password.");
    // Between the field it is about and the next one, not under the buttons.
    expect(said.previousElementSibling).toContainElement(screen.getByLabelText('Current password'));
    expect(screen.getByLabelText('Current password')).toBeInvalid();
    expect(told).toEqual([]);

    // Not the sentence of a refusal nobody named: "you may not do that here".
    i18next.addResourceBundle('de', 'translation', await catalogue('de'));
    await i18next.changeLanguage('de');
    expect(await screen.findByRole('alert')).toHaveTextContent('Das aktuelle Passwort stimmt nicht.');
    await i18next.changeLanguage('en');
  });
});

/**
 * The zone is the one setting the server acts on - quiet hours are read in it -
 * so this device's zone is offered as a hint and written only when chosen.
 */
describe('the time zone', () => {
  const menu = () => screen.findByRole('combobox', { name: 'Time zone' });

  it('draws the zone the account keeps, and says where this device is when that is somewhere else', async () => {
    server.me = meWith({ preferences: { ...meWith().preferences, timezone: 'UTC' } });
    const elsewhere = draw();

    expect(await menu()).toHaveValue('UTC');
    expect(screen.getByText('This device is in Europe/Berlin.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Europe/Berlin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Time zone' })).toHaveAccessibleDescription(/the same on every device/);
    expect(server.patched).toEqual([]);
    elsewhere.unmount();

    device.zone = 'UTC';
    draw();
    expect(await menu()).toHaveValue('UTC');
    expect(screen.getByText('clock times and quiet hours follow it')).toBeInTheDocument();
  });

  it('keeps UTC on offer, which the browser does not list and the migration left every account on', async () => {
    await drawLoaded();

    fireEvent.change(await menu(), { target: { value: 'Asia/Tokyo' } });
    await waitFor(() => expect(server.patched).toHaveLength(1));

    expect(await screen.findByRole('option', { name: 'UTC' })).toBeInTheDocument();
  });

  it('sends the zone alone, says so, and puts the zone it replaced back when that is taken back', async () => {
    await drawLoaded();

    fireEvent.change(await menu(), { target: { value: 'America/New_York' } });

    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Time zone: America/New_York']));
    expect(server.patched).toEqual([{ preferences: { timezone: 'America/New_York' } }]);

    await told[0].undo!();
    expect(server.patched[1]).toEqual({ preferences: { timezone: 'Europe/Berlin' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Europe/Berlin'));
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
    expect(told).toEqual([{ label: 'Chrome · macOS signed out', undo: null }]);
  });

  it('signs every other browser out in one act, and keeps this one', async () => {
    await drawLoaded();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign every other browser out' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign the others out' }));

    await waitFor(() => expect(server.sweptOthers).toBe(1));
    // The list is read again, and what is left is the browser doing the asking.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('this device')).toBeInTheDocument();
    // The question goes with the act it asked about, which the toast then names.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(told).toEqual([{ label: 'Every other browser signed out', undo: null }]);
  });

  /**
   * The sweep sits among the per-row Sign outs and reaches every device the
   * account is signed in on, so the tap that opens it must end nothing - and
   * what it then says has to be the effect rather than a count, because what
   * this browser has loaded is not what the account has.
   */
  it('asks before the sweep, ends nothing while it asks, and says what it will do', async () => {
    await drawLoaded();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign every other browser out' }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/is signed out at once/)).toBeInTheDocument();
    expect(within(sheet).getByText(/This browser stays signed in/)).toBeInTheDocument();
    expect(within(sheet).getByText(/cannot be brought back/)).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\d/);
    expect(server.sweptOthers).toBe(0);
  });

  it('leaves every session standing when the question is closed', async () => {
    await drawLoaded();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign every other browser out' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.sweptOthers).toBe(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(told).toEqual([]);
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

    // One row: what the file holds in a line, and the long of it behind the (i).
    expect(screen.getByText('JSON, CSV, diary photos and films in one zip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Export everything' })).toHaveAccessibleDescription(/the zip counts them per camera/);

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    // A button, not a link: the zip is served to a session, and nothing sets an
    // Authorization header on a navigation - so the bytes are fetched and handed
    // to a download of the app's own making.
    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB/ })).toBeInTheDocument();
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
    const first = draw();
    await screen.findByText('login@example.org');

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));
    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB/ })).toBeInTheDocument();

    first.unmount();
    draw(first.client);

    // A button, not a link: the zip is served to a session, and nothing sets an
    // Authorization header on a navigation - so the bytes are fetched and handed
    // to a download of the app's own making.
    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build the zip' })).not.toBeInTheDocument();
    expect(server.exportsAsked).toBe(1);
  });

  it('finds it after a reload too, from what this browser kept, without asking for a new one', async () => {
    const first = draw();
    await screen.findByText('login@example.org');
    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));
    await screen.findByRole('button', { name: /Download · 12\.4 MB/ });
    first.unmount();

    // A reload: nothing of the cache is left.
    await drawLoaded();

    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build the zip' })).not.toBeInTheDocument();
    expect(server.exportsAsked).toBe(1);
  });

  it('offers a new one beside a file older than the hour the route answers it for', async () => {
    server.builtAt = DateTime.now().minus({ hours: 3 }).toISO();
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB · built 3\sh ago/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build the zip' })).toBeEnabled();
  });

  it('takes a kept file that is no longer there as no file, not as a refusal', async () => {
    localStorage.setItem('terp.export.undefined', 'media-gone');
    await drawLoaded();

    expect(await screen.findByRole('button', { name: 'Build the zip' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dates the file it hands over, because the route answers a standing one for an hour', async () => {
    server.builtAt = DateTime.now().minus({ minutes: 40 }).toISO();
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    expect(await screen.findByRole('button', { name: /Download · 12\.4 MB · built 40\smin ago/ })).toBeInTheDocument();
  });

  /**
   * A whole account of a year's growing is the one file this app builds that
   * leaves the megabytes behind, and it is the figure somebody decides whether
   * to start the download on: four digits of megabytes is not something anybody
   * can weigh against the room on their disk.
   */
  it('states a zip of more than a gigabyte in gigabytes', async () => {
    server.exportBytes = 1_317_277_368;
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Build the zip' }));

    expect(await screen.findByRole('button', { name: /Download · 1\.2 GB/ })).toBeInTheDocument();
  });

  it('weighs a file in the unit it is felt in, with the decimal the language writes', async () => {
    expect(fileSize(1_317_277_368)).toBe('1.2 GB');
    expect(fileSize(1024 ** 3)).toBe('1.0 GB');
    expect(fileSize(13_000_000)).toBe('12.4 MB');
    // A diary of a fortnight, which would round to 0.0 MB and read as a file that went wrong.
    expect(fileSize(45_000)).toBe('44 kB');

    // Whose decimal that is comes from the app and from nowhere else. It used
    // to come from an argument, and the one caller that forgot it - the grow
    // report's button - wrote a full stop on a German page for as long as the
    // browser underneath was an English one.
    await i18next.changeLanguage('de');
    expect(fileSize(1_317_277_368)).toBe('1,2 GB');
    expect(fileSize(13_000_000)).toBe('12,4 MB');

    await i18next.changeLanguage('en');
  });

  it('will not delete anything until the handle has been typed', async () => {
    await drawLoaded();

    expect(screen.getByText(reading('really deleted, not hidden · devices can be added again'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account …' }));

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/deleted rather than hidden, and there is no way back/)).toBeInTheDocument();
    // Whom else it reaches is said where the deed is confirmed.
    expect(screen.getByText(/Whoever sees your places loses them, and whoever follows your grows loses those too/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type you to confirm'), { target: { value: 'yo' } });
    expect(confirm).toBeDisabled();
    expect(server.deleted).toBe(0);

    fireEvent.change(screen.getByLabelText('Type you to confirm'), { target: { value: 'you' } });
    // Armed by the handle, in the one danger style: filled in the alarm's red, never an outline.
    expect(confirm).toBeEnabled();
    expect(confirm.className).toMatch(/dangerFilled/);
    fireEvent.click(confirm);
    await waitFor(() => expect(server.deleted).toBe(1));
  });

  it('ends on the sign-in page, told that the account is gone, and asks the server to end no session it has forgotten', async () => {
    const forgets = vi.spyOn(store, 'logOut');
    const SignInPage = () => <p>sign-in {JSON.stringify(useLocation().state)}</p>;
    drawAt(
      <Toast told={told}>
        <Routes>
          <Route path="/me/account" element={<Account />} />
          <Route path="/sign-in" element={<SignInPage />} />
        </Routes>
      </Toast>,
      { at: '/me/account' },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account …' }));
    fireEvent.change(screen.getByLabelText('Type you to confirm'), { target: { value: 'you' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText('sign-in {"deleted":true}')).toBeInTheDocument();
    expect(forgets).toHaveBeenCalledWith(true);
    expect(server.revoked).toEqual([]);
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account …' }));

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

    expect(
      screen.getByText('The demo has no account of its own: there are no notifications, no account and no privacy settings here.'),
    ).toBeInTheDocument();
    expect(fetchStub.mock.calls.filter(([input]) => String(input).includes('/v1/'))).toHaveLength(0);
  });
});
