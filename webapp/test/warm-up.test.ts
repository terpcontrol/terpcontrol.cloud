import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTokens, SessionUser } from '@fg2/shared-types/v1';
import { DAY_MS, MINUTE_MS } from '@/ui/days';
import { json } from './harness';

/**
 * What the app asks for before its first render.
 *
 * Opened cold, a screen behind the session waited for the catalogues, a render,
 * the session's refresh, another render and only then the home. The refresh and
 * the home are now on their way while the catalogues load - where the address
 * needs a session, and with the home asked only once there is one.
 */

const USER: SessionUser = { id: 'user-1', handle: 'you', isAdmin: false, isDemo: false };

const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

const TOKENS: SessionTokens = {
  userToken: { token: 'user-1', validUntil: at(5 * MINUTE_MS) },
  refreshToken: { token: 'refresh-2', validUntil: at(30 * DAY_MS) },
  mediaToken: { token: 'media-1', validUntil: at(30 * DAY_MS) },
};

const EMPTY_HOME = { spaces: [], followedGrows: [], people: [], layers: { diary: true } };

/** The paths the app asked for, in order; the refresh answers `refresh`, everything else an empty home. */
const serve = (refresh: Response): string[] => {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      asked.push(path);
      return path.endsWith('/sessions/refresh') ? refresh.clone() : json(EMPTY_HOME);
    }),
  );
  return asked;
};

/** A fresh session store and query cache, and the warm-up that reads them. */
const fresh = async () => {
  vi.resetModules();
  const [{ warmUp }, { queryClient }] = await Promise.all([import('@/app/warm-up'), import('@/api/query-client')]);
  return { warmUp, queryClient };
};

/** Until every request the warm-up set going has answered. */
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the warm-up before the first render', () => {
  beforeEach(() => {
    localStorage.setItem(
      'terp.session',
      JSON.stringify({
        refreshToken: 'refresh-1',
        refreshTokenUntil: Date.now() + 30 * DAY_MS,
        user: USER,
        sessionId: 'session-1',
        stayLoggedIn: true,
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('refreshes the stored session and then asks for the home, on a screen behind the session', async () => {
    const asked = serve(json(TOKENS));
    const { warmUp, queryClient } = await fresh();

    warmUp({ pathname: '/' });
    await vi.waitFor(() => expect(queryClient.getQueryData(['home'])).toEqual(EMPTY_HOME));

    expect(asked.map(path => path.replace(/^.*\/v1/, ''))).toEqual(['/sessions/refresh', '/home']);
  });

  it('does the same on any other screen in the shell, whose navigation reads the home too', async () => {
    const asked = serve(json(TOKENS));
    const { warmUp, queryClient } = await fresh();

    warmUp({ pathname: '/charts' });
    await vi.waitFor(() => expect(queryClient.getQueryData(['home'])).toEqual(EMPTY_HOME));

    expect(asked).toHaveLength(2);
  });

  it('does not ask for the home when the session could not be refreshed, so no failed first read is cached', async () => {
    const asked = serve(json({ status: 503 }, 503));
    const { warmUp, queryClient } = await fresh();

    warmUp({ pathname: '/' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await settled();

    expect(asked[0]).toMatch(/\/sessions\/refresh$/);
    expect(queryClient.getQueryState(['home'])).toBeUndefined();
  });

  it('leaves the public pages alone, which decide for themselves whether a stored session is their business', async () => {
    const asked = serve(json(TOKENS));
    const { warmUp } = await fresh();

    for (const pathname of ['/shared/some-token', '/sign-in', '/g/some-grow', '/@somebody', '/recover']) warmUp({ pathname });
    await settled();

    expect(asked).toEqual([]);
  });
});
