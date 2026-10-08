import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { DiaryOffer } from '@/screens/home/DiaryOffer';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * The one grey line Start shows an account that keeps no diary. Both answers
 * are kept with the account rather than in this browser, so a "no thanks"
 * given on a phone is not asked again on the laptop - and both send the one
 * preference alone, because `PATCH /me` keeps what a body leaves out.
 */

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
  preferences: {
    units: { temperature: 'celsius', weight: 'grams', volume: 'liters' },
    locale: 'de',
    timezone: 'Europe/Berlin',
    timezoneChosen: true,
    diary: null,
  },
  retention: { climateDays: null },
  climateRetention: { installDays: null, appliesDays: null },
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
  layers: { diary: false },
});

const server = { me: me(), patched: [] as MeUpdate[], asked: [] as string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';
  server.asked.push(`${method} ${pathname}`);

  if (pathname === '/v1/me' && method === 'GET') return json(server.me);
  if (pathname === '/v1/me' && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    const diary = body.preferences?.diary ?? null;
    server.me = { ...server.me, ...body, preferences: { ...server.me.preferences, ...body.preferences }, layers: { diary: diary === 'on' } } as Me;
    return json(server.me);
  }
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <DiaryOffer />
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
  server.me = me();
  server.patched = [];
  server.asked = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the diary, offered on Start', () => {
  it('is one line with two answers and what the diary is', () => {
    draw();

    expect(screen.getByRole('button', { name: 'Turn on the grow diary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18next.t('help.about', { title: 'Grow diary' }) })).toBeInTheDocument();
  });

  it('keeps "no thanks" with the account, sending that answer alone', async () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({ preferences: { diary: 'off' } });
  });

  it('switches the diary on for the account', async () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on the grow diary' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].preferences?.diary).toBe('on');
  });
});
