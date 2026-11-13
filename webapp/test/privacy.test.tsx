import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, GrowUpdate, Me, MeUpdate, ShareLink } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { cutoffDay, narrows } from '@/screens/me/privacy/climate';
import { Privacy } from '@/screens/me/privacy/Privacy';
import { drawAt, json, NOT_FOUND, reading } from './harness';
import { meWith } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Me › Privacy and profile: what a stranger finds, what other people are
 * shown, and how long it is kept.
 *
 * `PATCH /me` replaces each object it is handed rather than merging into it, so
 * the thing to check about every switch is not only the field it moved but that
 * the other field of the same object went back exactly as it was read - a
 * screen that sent `{ hideWeights }` alone would quietly turn plant counts back
 * on - and the same of the toast that takes a switch back: it moves its one
 * field in the object as it stands by then. Of the grows, that only this
 * account's own get a switch, that the switch writes the one field and the
 * list then agrees with the server, and that a private grow says which links
 * still open it - a read-only view does, and the public page's own address
 * does not. A shorter climate window is checked for not happening until the
 * question that names what goes has been answered. And the footnote is checked
 * for promising only what this install keeps.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/ui/useNow', () => ({ useNow: () => NOW }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const me = (over: Partial<Me> = {}): Me =>
  meWith({ handle: 'chrisgrows', privacy: { hideWeights: true, hideCounts: false }, retention: { climateDays: 365 }, ...over });

const grow = (over: Partial<GrowListItem>): GrowListItem =>
  ({ id: 'grow-1', ownerId: 'user-1', name: 'Spring run #3', slug: 'spring-run-3', visibility: 'public', isDemo: false, ...over }) as GrowListItem;

const GROWS = [
  grow({}),
  grow({ id: 'grow-2', name: 'Balcony tomatoes', slug: 'balcony-tomatoes', visibility: 'private' }),
  grow({ id: 'grow-9', ownerId: 'user-mia', name: "Mia's grow", slug: 'mias-grow' }),
];

const link = (id: string, kind: ShareLink['kind']): ShareLink => ({
  id,
  createdAt: '2026-09-01T12:00:00.000Z',
  token: `tok-${id}`,
  kind,
  subject: { type: 'grow', id: 'grow-2' },
  range: { startsAt: null, endsAt: null },
  includeCameras: false,
  createdBy: 'user-1',
  expiresAt: null,
  revokedAt: null,
  state: { openCount: 3, lastOpenedAt: null },
});

const server = {
  me: me(),
  grows: GROWS,
  patched: [] as MeUpdate[],
  growsPatched: [] as { id: string; body: GrowUpdate }[],
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';

  if (path === '/me' && method === 'GET') return json(server.me);
  if (path === '/me' && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    server.me = { ...server.me, ...body } as Me;
    return json(server.me);
  }
  if (path === '/grows' && method === 'GET') return json({ items: server.grows, nextCursor: null });
  const one = path.match(/^\/grows\/([^/]+)$/);
  if (one && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as GrowUpdate;
    server.growsPatched.push({ id: one[1], body });
    server.grows = server.grows.map(row => (row.id === one[1] ? ({ ...row, ...body } as GrowListItem) : row));
    return json(server.grows.find(row => row.id === one[1]));
  }
  // A read-only view of the private grow, and the address of its public page, which opens nothing while it is private.
  if (path === '/share-links') return json({ items: [link('view', 'view'), link('page', 'public_page')], nextCursor: null });
  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const told: Told[] = [];

const draw = () =>
  drawAt(
    <Toast told={told}>
      <Privacy />
    </Toast>,
    { at: '/me/privacy' },
  );

const drawLoaded = async (over: Partial<Me> = {}) => {
  server.me = me(over);
  draw();
  await screen.findByRole('switch', { name: 'Public profile' });
};

const labels = () => told.map(one => one.label);

/** A switch, once the write before it has landed: the page holds still while one is on its way. */
const free = async (name: string) => {
  const control = screen.getByRole('switch', { name });
  await waitFor(() => expect(control).toBeEnabled());

  return control;
};

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  told.length = 0;
  server.me = me();
  server.grows = GROWS;
  server.patched = [];
  server.growsPatched = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('what a stranger finds', () => {
  it('names the handle the profile would be at while it is private, and offers no address to copy', async () => {
    await drawLoaded();

    expect(screen.getByRole('heading', { name: 'Privacy and profile' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Public profile' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(reading('@chrisgrows · lists only grows you set public'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the profile address' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /\/@chrisgrows$/ })).not.toBeInTheDocument();
  });

  it('shows the profile’s address as the link that opens it, with Copy beside it, once it is public', async () => {
    await drawLoaded({ publicProfile: true });

    expect(screen.getByRole('switch', { name: 'Public profile' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('link', { name: /\/@chrisgrows$/ })).toHaveAttribute('href', '/@chrisgrows');
    expect(screen.getByRole('button', { name: 'Copy the profile address' })).toBeInTheDocument();
  });

  it('promises of the profile only what the app can set: the username and the public grows', async () => {
    await drawLoaded();

    const help = screen.getByRole('button', { name: 'About Public profile' });
    expect(help).toHaveAccessibleDescription(/shows your username and your public grows/);
    expect(help).not.toHaveAccessibleDescription(/bio|picture/);
  });

  it('publishes the profile on its own, which is not part of the privacy object, and takes it back the same way', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Public profile' }));

    await waitFor(() => expect(labels()).toEqual(['Your profile is public']));
    expect(server.patched).toEqual([{ publicProfile: true }]);

    await told[0].undo!();
    expect(server.patched[1]).toEqual({ publicProfile: false });
  });

  it('lists only this account’s own grows, each with its state, its address and the links that still open it', async () => {
    await drawLoaded();

    expect(await screen.findByRole('switch', { name: 'Public page of Spring run #3' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Public grows')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\/g\/spring-run-3$/ })).toHaveAttribute('href', '/g/spring-run-3');
    expect(screen.getByRole('button', { name: 'Copy the public address' })).toBeInTheDocument();

    expect(screen.getByRole('switch', { name: 'Public page of Balcony tomatoes' })).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByText('private · 1 link opens it')).toBeInTheDocument();

    expect(screen.getAllByRole('switch', { name: /^Public page of/ })).toHaveLength(2);
    expect(screen.queryByText("Mia's grow")).not.toBeInTheDocument();
  });

  it('writes the one field a grow’s switch is about, says so, and the list then says what the server does', async () => {
    await drawLoaded();

    fireEvent.click(await screen.findByRole('switch', { name: 'Public page of Balcony tomatoes' }));

    await waitFor(() => expect(labels()).toEqual(['Balcony tomatoes is public now']));
    expect(server.growsPatched).toEqual([{ id: 'grow-2', body: { visibility: 'public' } }]);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Public page of Balcony tomatoes' })).toHaveAttribute('aria-checked', 'true'));
    // Public, its own address opens it too.
    expect(await screen.findByRole('link', { name: /\/g\/balcony-tomatoes$/ })).toBeInTheDocument();
    expect(screen.getByText('2 links open it')).toBeInTheDocument();
    expect(server.patched).toEqual([]);

    await told[0].undo!();
    expect(server.growsPatched[1]).toEqual({ id: 'grow-2', body: { visibility: 'private' } });
    expect(await screen.findByText('private · 1 link opens it')).toBeInTheDocument();
  });

  it('says plainly what a public grow shows a stranger, including the cams, and what it never shows', async () => {
    await drawLoaded();

    const help = screen.getByRole('button', { name: 'About Public grows' });
    expect(help).toHaveAccessibleDescription(/the camera’s pictures/);
    expect(help).toHaveAccessibleDescription(
      /It never shows the place’s current readings, its devices, its alarms or its tasks, and never your e-mail/,
    );
    expect(help).toHaveAccessibleDescription(/nobody can write/);
  });

  it('says so when there is no grow of one’s own', async () => {
    server.grows = [grow({ id: 'grow-9', ownerId: 'user-mia', name: "Mia's grow" })];
    await drawLoaded();

    expect(await screen.findByText('No grows of your own yet')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /^Public page of/ })).not.toBeInTheDocument();
  });
});

describe('what other people are shown', () => {
  it('draws the two switches as the account holds them', async () => {
    await drawLoaded();

    expect(screen.getByText('Shared views')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Hide harvest weights in shared views' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Hide plant counts in shared views' })).toHaveAttribute('aria-checked', 'false');
  });

  it('sends the whole privacy object with one field changed, so the other is not turned back on', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Hide plant counts in shared views' }));

    await waitFor(() => expect(labels()).toEqual(['Plant counts are hidden in shared views']));
    expect(server.patched).toEqual([{ privacy: { hideWeights: true, hideCounts: true } }]);
  });

  /**
   * The toast of one switch outlives the tap on the next. Taken back then, it
   * must not carry the object it was read from: that would switch the second
   * one back as well.
   */
  it('takes one switch back into the object as it stands by then, so a switch moved in between stays', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Hide plant counts in shared views' }));
    await waitFor(() => expect(told).toHaveLength(1));
    fireEvent.click(await free('Hide harvest weights in shared views'));
    await waitFor(() => expect(labels()).toEqual(['Plant counts are hidden in shared views', 'Harvest weights show in shared views again']));
    expect(server.patched[1]).toEqual({ privacy: { hideWeights: false, hideCounts: true } });

    await told[0].undo!();

    expect(server.patched[2]).toEqual({ privacy: { hideWeights: false, hideCounts: false } });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hide plant counts in shared views' })).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('switch', { name: 'Hide harvest weights in shared views' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('how long anything is kept', () => {
  const menu = () => screen.getByRole('combobox', { name: 'Keep climate history' });

  it('shows what the account keeps and sends a wider window as soon as it is chosen', async () => {
    await drawLoaded();
    expect(menu()).toHaveValue('365');

    expect(screen.getByText('Retention')).toBeInTheDocument();
    fireEvent.change(menu(), { target: { value: '730' } });

    // Taking a wider window back would be a narrower one, which is asked about: the toast offers none.
    await waitFor(() => expect(told).toEqual([{ label: 'Keep climate history: 2 years', from: 'me:retention.climateDays', undo: null }]));
    expect(server.patched).toEqual([{ retention: { climateDays: 730 } }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends null for keeping everything at once, which narrows nothing', async () => {
    await drawLoaded();

    fireEvent.change(menu(), { target: { value: '' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].retention).toEqual({ climateDays: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before a narrower window, names what goes and from when, and writes only once told to keep it', async () => {
    await drawLoaded();

    fireEvent.change(menu(), { target: { value: '90' } });

    const sheet = within(await screen.findByRole('dialog'));
    expect(server.patched).toHaveLength(0);
    expect(
      sheet.getByText(
        'Climate readings older than 90 days become one figure a day: everything before 24 Jun 2026, and from now on each day that leaves the window. The daily figure stays on Timeline and in your export; the readings themselves are deleted and cannot come back.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(sheet.getByRole('button', { name: 'Keep 90 days' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].retention).toEqual({ climateDays: 90 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the account and the menu where they were when the question is put away', async () => {
    await drawLoaded();

    fireEvent.change(menu(), { target: { value: '90' } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.patched).toHaveLength(0);
    expect(told).toEqual([]);
    expect(menu()).toHaveValue('365');
  });

  it('asks before any number where everything was kept, since every number is narrower than that', async () => {
    await drawLoaded({ retention: { climateDays: null } });

    fireEvent.change(menu(), { target: { value: '730' } });

    expect(await screen.findByRole('dialog')).toHaveTextContent('Climate readings older than 2 years');
    expect(server.patched).toHaveLength(0);
  });

  it('knows which choices keep less, and where the sweep would then cut', () => {
    expect(narrows(365, 90)).toBe(true);
    expect(narrows(null, 730)).toBe(true);
    expect(narrows(90, 365)).toBe(false);
    expect(narrows(365, 365)).toBe(false);
    expect(narrows(365, null)).toBe(false);
    expect(narrows(null, null)).toBe(false);

    // The start of the UTC day, that many days back: the server's own cut.
    expect(cutoffDay(90, NOW).toISO()).toBe('2026-06-24T00:00:00.000Z');
    expect(cutoffDay(90, DateTime.fromISO('2026-09-22T23:30:00.000+02:00')).toISO()).toBe('2026-06-24T00:00:00.000Z');
  });

  it("states the install's own window for a free camera's stills rather than a number written into the app", async () => {
    await drawLoaded();

    // This install has turned no sweep on, which is the default and which the
    // line has to say plainly: nothing of a free camera's is deleted here.
    expect(screen.getByText(/free: kept just as long on this install/)).toBeInTheDocument();
  });

  it('says what this install will really keep where the account has said nothing', async () => {
    await drawLoaded({
      retention: { climateDays: null },
      climateRetention: { installDays: 365, appliesDays: 365 },
    });

    expect(screen.getByText(/this install keeps at most 365 days of raw samples/)).toBeInTheDocument();
  });

  it('names the days where the install has named them', async () => {
    await drawLoaded({ premium: { enforced: true, extendUrl: null, priceLabel: null, free: { stillWidth: 640, stillDays: 90, timelapseDays: 30 } } });

    expect(screen.getByText(/free: 90 days/)).toBeInTheDocument();
  });
});

describe('the footnote', () => {
  it('promises a self-hosted install nothing about where its servers stand, and no mode that does not exist', async () => {
    await drawLoaded();

    expect(screen.getByText('No location is ever stored.')).toBeInTheDocument();
    expect(screen.queryByText(/EU/)).toBeNull();
    expect(screen.queryByText(/[Tt]eam mode|club/)).toBeNull();
  });

  it('says where the servers are on the hosted install, which is the one that enforces Premium', async () => {
    await drawLoaded({
      premium: { enforced: true, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
    });

    expect(screen.getByText('No location is ever stored. Servers in the EU.')).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('leads to Me, as the arrow beside the title', async () => {
    await drawLoaded();

    expect(screen.getByRole('link', { name: 'Back to Me' })).toHaveAttribute('href', '/me');
  });
});

describe('the demo', () => {
  it('is told it has no account to settle, and asks for none', async () => {
    session.demo = true;
    draw();

    expect(
      await screen.findByText('The demo has no account of its own: there are no notifications, no account and no privacy settings here.'),
    ).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
