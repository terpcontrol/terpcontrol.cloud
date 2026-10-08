import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { DiaryOffer } from '@/screens/home/DiaryOffer';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { translate } from './translations';

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

const me = (): Me =>
  meWith({
    preferences: {
      units: { temperature: 'celsius', weight: 'grams', volume: 'liters' },
      locale: 'de',
      timezone: 'Europe/Berlin',
      timezoneChosen: true,
      diary: null,
    },
    layers: { diary: false },
  });

const server = { me: me(), patched: [] as MeUpdate[], asked: [] as string[] };

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
  return json(NOT_FOUND, 404);
});

const draw = () => drawAt(<DiaryOffer />);

beforeAll(() => translate());

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
