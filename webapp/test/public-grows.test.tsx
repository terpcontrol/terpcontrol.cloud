import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, GrowUpdate, Me, ShareLink } from '@fg2/shared-types/v1';
import { PublicGrows } from '@/screens/me/sharing/PublicGrows';

/**
 * Me › Public grows and profile: which grows have a page anybody can open.
 *
 * What is checked is that only this account's own grows get a switch, that the
 * switch writes the one field and the list then agrees with the server, that
 * the profile's address is named while its switch stays on the privacy screen,
 * and that a private grow says which links still open it - a read-only view does,
 * and the public page's own address does not.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const grow = (over: Partial<GrowListItem>): GrowListItem =>
  ({ id: 'grow-1', ownerId: 'user-1', name: 'Spring run #3', slug: 'spring-run-3', visibility: 'public', ...over }) as GrowListItem;

const link: ShareLink = {
  id: 'link-1',
  createdAt: '2026-09-01T12:00:00.000Z',
  token: 'tok-1',
  kind: 'view',
  subject: { type: 'grow', id: 'grow-2' },
  range: { startsAt: null, endsAt: null },
  includeCameras: false,
  createdBy: 'user-1',
  expiresAt: null,
  revokedAt: null,
  state: { openCount: 3, lastOpenedAt: null },
};

const server = {
  grows: [] as GrowListItem[],
  me: { handle: 'chrisgrows', publicProfile: false, privacy: { hideWeights: false, hideCounts: false } } as Me,
  patched: [] as { id: string; body: GrowUpdate }[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';

  if (path === '/grows' && method === 'GET') return json({ items: server.grows, nextCursor: null });
  const one = path.match(/^\/grows\/([^/]+)$/);
  if (one && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as GrowUpdate;
    server.patched.push({ id: one[1], body });
    server.grows = server.grows.map(row => (row.id === one[1] ? ({ ...row, ...body } as GrowListItem) : row));
    return json(server.grows.find(row => row.id === one[1]));
  }
  if (path === '/me') return json(server.me);
  if (path === '/share-links') return json({ items: [link], nextCursor: null });
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/public']}>
        <PublicGrows />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawLoaded = async () => {
  draw();
  await screen.findByText('@chrisgrows');
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
  server.grows = [
    grow({}),
    grow({ id: 'grow-2', name: 'Balcony tomatoes', slug: 'balcony-tomatoes', visibility: 'private' }),
    grow({ id: 'grow-9', ownerId: 'user-mia', name: "Mia's grow", slug: 'mias-grow' }),
  ];
  server.me = { ...server.me, publicProfile: false };
  server.patched = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('the grows', () => {
  it('lists only this account’s own grows, each with its state, its address and the links that still open it', async () => {
    await drawLoaded();

    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getByText('Grows').nextElementSibling).toHaveTextContent('1 public · 1 private');

    expect(screen.getByRole('switch', { name: 'Public page of Spring run #3' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/\/g\/spring-run-3$/)).toBeInTheDocument();

    expect(screen.getByRole('switch', { name: 'Public page of Balcony tomatoes' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('private · 1 link opens it')).toBeInTheDocument();

    expect(screen.queryByText("Mia's grow")).not.toBeInTheDocument();
  });

  it('writes the one field a switch is about, and the list then says what the server does', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Public page of Balcony tomatoes' }));

    await waitFor(() => expect(server.patched).toEqual([{ id: 'grow-2', body: { visibility: 'public' } }]));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Public page of Balcony tomatoes' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText(/\/g\/balcony-tomatoes/)).toBeInTheDocument();
  });

  it('says plainly what a public grow shows a stranger, including the cams, and what it never shows', async () => {
    await drawLoaded();

    const statement = screen.getByText(/A public grow shows a stranger/);
    expect(statement).toHaveTextContent("the camera's pictures");
    expect(statement).toHaveTextContent("It never shows the tent's live values, its devices, its alarms or its tasks, and never your e-mail");
    expect(statement).toHaveTextContent('nobody can write');
  });

  it('says so when there is no grow of one’s own', async () => {
    server.grows = [grow({ id: 'grow-9', ownerId: 'user-mia', name: "Mia's grow" })];
    await drawLoaded();

    expect(screen.getByText('No grows of your own yet')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('the profile', () => {
  it('names the address and points at the privacy screen for its switch rather than drawing a second one', async () => {
    await drawLoaded();

    expect(screen.getByText('not public · the switch is under Privacy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy ›' })).toHaveAttribute('href', '/me/privacy');
    expect(screen.queryByRole('button', { name: 'Copy the profile address' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Public profile' })).not.toBeInTheDocument();
  });

  it('shows the profile’s address with Copy once it is public', async () => {
    server.me = { ...server.me, publicProfile: true };
    await drawLoaded();

    expect(screen.getByText(/\/@chrisgrows$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the profile address' })).toBeInTheDocument();
  });
});

describe('the demo', () => {
  it('is told it has nothing to publish, and asks for nothing', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no grows of its own to publish.')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
