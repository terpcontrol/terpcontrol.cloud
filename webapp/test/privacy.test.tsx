import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { Privacy } from '@/screens/me/privacy/Privacy';

/**
 * Me › Privacy: what other people are shown, how long it is kept, and the way
 * out.
 *
 * `PATCH /me` replaces each object it is handed rather than merging into it, so
 * the thing to check about every switch is not only the field it moved but that
 * the other field of the same object went back exactly as it was read - a
 * screen that sent `{ hideWeights }` alone would quietly turn plant counts back
 * on. The deletion is checked for the opposite reason: that it does not happen
 * until the handle has been typed.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
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

const server = { me: me(), patched: [] as MeUpdate[], deleted: 0 };

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
  it('shows what the account keeps and sends a new length in days', async () => {
    await drawLoaded();
    const menu = screen.getByRole('combobox', { name: 'Keep climate history' });
    expect(menu).toHaveValue('365');

    fireEvent.change(menu, { target: { value: '90' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].retention).toEqual({ climateDays: 90 });
  });

  it('sends null for keeping everything, which is what an install-long retention is', async () => {
    await drawLoaded();

    fireEvent.change(screen.getByRole('combobox', { name: 'Keep climate history' }), { target: { value: '' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].retention).toEqual({ climateDays: null });
  });

  it("states the install's own window for a free camera's stills rather than a number written into the app", async () => {
    await drawLoaded();

    // This install has turned no sweep on, which is the default and which the
    // line has to say plainly: nothing of a free camera's is deleted here.
    expect(screen.getByText(/free: kept just as long on this install/)).toBeInTheDocument();
    expect(screen.getByText(/one grow exports from its own page today/)).toBeInTheDocument();
  });

  it('names the days where the install has named them', async () => {
    await drawLoaded({ premium: { enforced: true, extendUrl: null, priceLabel: null, free: { stillWidth: 640, stillDays: 90, timelapseDays: 30 } } });

    expect(screen.getByText(/free: 90 days/)).toBeInTheDocument();
  });
});

describe('the way out', () => {
  it('will not delete anything until the handle has been typed', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '…' }));

    const confirm = screen.getByRole('button', { name: 'Delete my account' });
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

describe('the demo', () => {
  it('is told it has no account to settle, and asks for none', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no account of its own, so there is nothing here to settle.')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
