import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { DateTime } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate, Media } from '@fg2/shared-types/v1';
import { cutoffDay, narrows } from '@/screens/me/privacy/climate';
import { Privacy } from '@/screens/me/privacy/Privacy';

/**
 * Me › Privacy: what other people are shown, how long it is kept, and the way
 * out.
 *
 * `PATCH /me` replaces each object it is handed rather than merging into it, so
 * the thing to check about every switch is not only the field it moved but that
 * the other field of the same object went back exactly as it was read - a
 * screen that sent `{ hideWeights }` alone would quietly turn plant counts back
 * on. The two irreversible controls are checked for the opposite reason: that
 * neither happens until it has been asked about - the deletion until the
 * handle has been typed, and a shorter climate window until the question that
 * names what goes has been answered. The export is checked for being the job
 * it is on the account page - asked for once, followed by its media row -
 * rather than a chip that says the word Premium. And the footnote is checked
 * for promising only what this install keeps.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/ui/useNow', () => ({ useNow: () => NOW }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    // A test session carries no media token, and a file's address without one is nothing; the download link only needs an address.
    mediaUrl: (id: string) => `/media/${id}/content`,
    useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN),
  };
});

const me = (over: Partial<Me> = {}): Me => ({
  id: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'login@example.org',
  isAdmin: false,
  isActive: true,
  handle: 'chrisgrows',
  bio: null,
  avatarMediaId: null,
  publicProfile: false,
  privacy: { hideWeights: true, hideCounts: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  retention: { climateDays: 365 },
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
  ...over,
});

const exportRow = (status: 'queued' | 'ready'): Media =>
  ({
    id: 'media-export',
    kind: 'export',
    mime: 'application/zip',
    bytes: 13_000_000,
    exportJob: { status, scope: 'account', growId: null, startedAt: null, endedAt: null, error: null },
  }) as unknown as Media;

const server = { me: me(), patched: [] as MeUpdate[], deleted: 0, exportsAsked: 0 };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';

  if (url.endsWith('/v1/me') && method === 'GET') return json(server.me);
  if (url.endsWith('/v1/me') && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    server.me = { ...server.me, ...body } as Me;
    return json(server.me);
  }
  if (url.endsWith('/v1/me') && method === 'DELETE') {
    server.deleted += 1;
    return new Response(null, { status: 204 });
  }
  if (url.endsWith('/v1/me/export') && method === 'GET') {
    server.exportsAsked += 1;
    return json({ media: exportRow('queued'), queued: true }, 202);
  }
  if (url.endsWith('/v1/media/media-export') && method === 'GET') return json(exportRow('ready'));
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/privacy']}>
        <Privacy />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawLoaded = async (over: Partial<Me> = {}) => {
  server.me = me(over);
  draw();
  await screen.findByRole('switch', { name: 'Public profile' });
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
  server.patched = [];
  server.deleted = 0;
  server.exportsAsked = 0;
});

afterEach(() => vi.unstubAllGlobals());

describe('what other people are shown', () => {
  it('draws the three switches as the account holds them, and names the handle the profile would be at', async () => {
    await drawLoaded();

    expect(screen.getByRole('switch', { name: 'Hide harvest weights in shared views' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Hide plant counts in shared views' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Public profile' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('@chrisgrows · lists only grows you set public')).toBeInTheDocument();
  });

  it('sends the whole privacy object with one field changed, so the other is not turned back on', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Hide plant counts in shared views' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].privacy).toEqual({ hideWeights: true, hideCounts: true });
  });

  it('publishes the profile on its own, which is not part of that object', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Public profile' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({ publicProfile: true });
  });
});

describe('how long anything is kept', () => {
  const menu = () => screen.getByRole('combobox', { name: 'Keep climate history' });

  it('shows what the account keeps and sends a wider window as soon as it is chosen', async () => {
    await drawLoaded();
    expect(menu()).toHaveValue('365');

    fireEvent.change(menu(), { target: { value: '730' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].retention).toEqual({ climateDays: 730 });
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
        'Climate readings older than 90 days become one figure a day: everything before Jun 24, 2026, and from now on each day that leaves the window. The daily figure stays in the charts and in your export; the readings themselves are deleted and cannot come back.',
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

  it('asks for the whole account as a file when told to, follows the job, and never calls the export Premium', async () => {
    await drawLoaded();

    // Premium is the stills row's word and nobody else's on this screen.
    expect(screen.getAllByText('Premium')).toHaveLength(1);
    expect(screen.getByText('JSON + CSV + photos · yours to keep')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByRole('link', { name: /Download · 12\.4 MB/ })).toHaveAttribute('href', '/media/media-export/content');
    expect(server.exportsAsked).toBe(1);
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

describe('the way out', () => {
  it('will not delete anything until the handle has been typed', async () => {
    await drawLoaded();
    // The button is drawn as an ellipsis and has to be named after the row it ends.
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/deleted rather than hidden, and there is no way back/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type chrisgrows to confirm'), { target: { value: 'chrisgrow' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type chrisgrows to confirm'), { target: { value: 'chrisgrows' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(server.deleted).toBe(1));
  });
});

describe('the way back', () => {
  it('leads to Me at every width, as a chevron beside the title and as the trail', async () => {
    await drawLoaded();

    const ways = screen.getAllByRole('link', { name: 'Me' });
    expect(ways).toHaveLength(2);
    for (const way of ways) expect(way).toHaveAttribute('href', '/me');
  });
});

describe('the demo', () => {
  it('is told it has no account to settle, and asks for none', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no account of its own, so there is nothing here to settle.')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
