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
import type { FollowedGrowCard, HomeAnswer } from '@fg2/shared-types/v1';
import { Following } from '@/screens/me/sharing/Following';

/**
 * Me › Following: the diaries this account keeps reading.
 *
 * The tiles are the home strip's, so what is checked here is what the page
 * adds: that every followed grow is listed with whose it is and where it
 * stands, that the button on it stops the following, and that an account
 * following nobody is told so rather than shown an empty grid.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const NOW = DateTime.now();

const followed: FollowedGrowCard = {
  growId: 'grow-9',
  slug: 'autoflower-run',
  name: 'Autoflower run',
  handle: 'greenthumb',
  dayNumber: 51,
  stage: 'flowering',
  endedAt: null,
  coverMediaId: null,
  updatedAt: NOW.minus({ hours: 3 }).toISO()!,
};

const server = { home: { spaces: [], followedGrows: [followed], people: [] } as HomeAnswer, unfollowed: [] as string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';

  if (path === '/home') return json(server.home);
  if (path === '/follows' && method === 'GET') {
    return json({
      items: server.home.followedGrows.map(row => ({ id: `follow-${row.growId}`, userId: 'user-1', growId: row.growId, createdAt: NOW.toISO() })),
      nextCursor: null,
    });
  }
  const one = path.match(/^\/follows\/([^/]+)$/);
  if (one && method === 'DELETE') {
    server.unfollowed.push(one[1]);
    server.home = { ...server.home, followedGrows: server.home.followedGrows.filter(row => row.growId !== one[1]) };
    return new Response(null, { status: 204 });
  }
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/following']}>
        <Following />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.home = { spaces: [], followedGrows: [followed], people: [] };
  server.unfollowed = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('the followed grows', () => {
  it('lists each one under its owner’s handle with where it stands, counted, and leads to its public page', async () => {
    draw();

    expect(await screen.findByText('@greenthumb · Autoflower run')).toBeInTheDocument();
    expect(screen.getByText(/Day 51 · Flower · 3 h ago/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Autoflower run/ })).toHaveAttribute('href', '/g/autoflower-run');
    expect(screen.getByText('Following', { selector: 'span.label' }).nextElementSibling).toHaveTextContent('1 grow');
  });

  it('stops following from the tile, and the grow leaves the list', async () => {
    draw();
    const button = await screen.findByRole('button', { name: 'Following' });

    fireEvent.click(button);

    await waitFor(() => expect(server.unfollowed).toEqual(['grow-9']));
    await waitFor(() => expect(screen.queryByText('@greenthumb · Autoflower run')).not.toBeInTheDocument());
    expect(screen.getByText('You follow nobody yet. Follow sits at the top of any public diary.')).toBeInTheDocument();
  });

  it('says so when nobody is followed', async () => {
    server.home = { spaces: [], followedGrows: [], people: [] };
    draw();

    expect(await screen.findByText('You follow nobody yet. Follow sits at the top of any public diary.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('the demo', () => {
  it('is told following needs an account, and reads nothing', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo follows nobody; following needs an account of its own.')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
