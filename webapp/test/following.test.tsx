import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DateTime, Settings } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowedGrowCard, HomeAnswer } from '@fg2/shared-types/v1';
import { Following } from '@/screens/me/sharing/Following';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { translate } from './translations';

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

const server = {
  home: { spaces: [], followedGrows: [followed], people: [], layers: { diary: true } } as HomeAnswer,
  unfollowed: [] as string[],
  zone: 'Europe/Berlin',
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';

  if (path === '/home') return json(server.home);
  if (path === '/me') return json(meWith({ preferences: { ...meWith().preferences, timezone: server.zone } }));
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
  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const draw = () => drawAt(<Following />, { at: '/me/following' });

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.home = { spaces: [], followedGrows: [followed], people: [], layers: { diary: true } };
  server.unfollowed = [];
  server.zone = 'Europe/Berlin';
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

  it('dates a finished diary on the account’s calendar rather than the browser’s', async () => {
    // 22:31 UTC is still the 30th in Los Angeles and already the 1st in Tokyo.
    server.home = { ...server.home, followedGrows: [{ ...followed, endedAt: '2026-09-30T22:31:00.000Z' }] };
    server.zone = 'Asia/Tokyo';
    Settings.defaultZone = 'America/Los_Angeles';
    try {
      draw();

      expect(await screen.findByText(/ended 1 Oct 2026/)).toBeInTheDocument();
    } finally {
      Settings.defaultZone = 'system';
    }
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
    server.home = { spaces: [], followedGrows: [], people: [], layers: { diary: true } };
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
