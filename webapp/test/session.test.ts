import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResult, SessionTokens, SessionUser } from '@fg2/shared-types/v1';
import { DAY_MS, MINUTE_MS } from '@/ui/days';

/**
 * What a picture's address survives.
 *
 * The bearer token is renewed every few minutes and the media token rides in
 * the query string of every picture's URL, so replacing it on each renewal
 * rewrites the `src` of everything on screen and the browser fetches again what
 * it already holds. The rule this asserts is that a media token with weeks left
 * is kept, and one near its end is not.
 *
 * The store is a module-level singleton, so each test imports its own copy
 * after `vi.resetModules()` rather than trying to empty the one before it.
 */

const USER: SessionUser = { id: 'user-1', handle: 'you', isAdmin: false, isDemo: false };

const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

/** A tokens triple as the API answers one, with the media token's remaining life named by the caller. */
const triple = (tag: string, mediaLeftMs: number): SessionTokens => ({
  userToken: { token: `user-${tag}`, validUntil: at(5 * MINUTE_MS) },
  refreshToken: { token: `refresh-${tag}`, validUntil: at(30 * DAY_MS) },
  mediaToken: { token: `media-${tag}`, validUntil: at(mediaLeftMs) },
});

const result = (tag: string, mediaLeftMs: number): SessionResult => ({ ...triple(tag, mediaLeftMs), sessionId: 'session-1', user: USER });

/**
 * The API, reduced to the two routes the store calls. Each answer is taken in
 * turn, so a test says what the server says and in what order.
 */
const serve = (answers: unknown[]): void => {
  const queue = [...answers];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = queue.shift();
      if (body === undefined) throw new Error('the store asked for more than the test answered');
      return { ok: true, json: async () => body } as Response;
    }),
  );
};

/** A fresh store, and the `mediaUrl` that reads from it. */
const freshSession = async () => {
  vi.resetModules();
  return import('@/api/session');
};

describe('the media token across a refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves a picture at the same address, so nothing is downloaded twice', async () => {
    serve([result('first', 30 * DAY_MS), triple('second', 30 * DAY_MS), triple('third', 30 * DAY_MS)]);
    const { session, mediaUrl } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    const before = mediaUrl('picture-1', 320);

    await session.refresh(session.snapshot().tokens?.refreshToken);
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(before).toContain('media-first');
    expect(mediaUrl('picture-1', 320)).toBe(before);
  });

  it('still renews the bearer token, which is what a refresh is for', async () => {
    serve([result('first', 30 * DAY_MS), triple('second', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    await session.refresh(session.snapshot().tokens?.refreshToken);

    const tokens = session.snapshot().tokens;
    expect(tokens?.userToken).toBe('user-second');
    expect(tokens?.refreshToken).toBe('refresh-second');
    expect(tokens?.mediaToken).toBe('media-first');
  });

  it('takes the new one when the one in hand is near its end', async () => {
    // Under the day's margin, so the address changes once rather than breaking
    // while a card that nothing has re-rendered still points at it.
    serve([result('first', 6 * 60 * MINUTE_MS), triple('second', 30 * DAY_MS)]);
    const { session, mediaUrl } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    const before = mediaUrl('picture-1', 320);

    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(before).toContain('media-first');
    expect(mediaUrl('picture-1', 320)).toContain('media-second');
  });

  it('takes the new one when the server dates it with something nobody can read', async () => {
    const broken = result('first', 30 * DAY_MS);
    broken.mediaToken.validUntil = 'not a date';
    serve([broken, triple('second', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(session.snapshot().tokens?.mediaToken).toBe('media-second');
  });

  /**
   * No screen reaches this today - the sign-in page leaves as soon as somebody
   * is signed in - so the assertion is on the invariant rather than on a flow:
   * a media token is signed with the account it was issued to, and signing in
   * is where a different account arrives.
   */
  it('never carries one signing-in over to the next, whoever that turns out to be', async () => {
    serve([result('first', 30 * DAY_MS), result('second', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    await session.logIn({ email: 'someone@example.com', password: 'secret' });

    expect(session.snapshot().tokens?.mediaToken).toBe('media-second');
  });

  /**
   * A reload keeps the refresh token and nothing else, so the boot refresh has
   * nothing in hand and takes what it is given. Every picture's address
   * therefore changes once per reload, which is as it should be - the
   * alternative is a thirty-day credential in local storage - and is what
   * bounds this whole fix to the life of one page.
   */
  it('takes a new one at boot, because a reload keeps no token to carry', async () => {
    localStorage.setItem(
      'terp.session',
      JSON.stringify({
        refreshToken: 'refresh-stored',
        refreshTokenUntil: Date.now() + 30 * DAY_MS,
        user: USER,
        sessionId: 'session-1',
        stayLoggedIn: true,
      }),
    );
    serve([triple('afterBoot', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.restore();

    expect(session.snapshot().tokens?.mediaToken).toBe('media-afterBoot');
  });
});

/**
 * The margin itself, on a clock that does not move under the test. A day is
 * long enough that the ordinary case never reaches it, so the only way to know
 * the boundary is where it is meant to be is to stand on both sides of it.
 */
describe('the day the media token is swapped', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps one with a day and a moment left', async () => {
    serve([result('first', DAY_MS + 1000), triple('second', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(session.snapshot().tokens?.mediaToken).toBe('media-first');
  });

  it('swaps one with exactly a day left, because the margin is what it promises', async () => {
    serve([result('first', DAY_MS), triple('second', 30 * DAY_MS)]);
    const { session } = await freshSession();

    await session.logIn({ email: 'you@example.com', password: 'secret' });
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(session.snapshot().tokens?.mediaToken).toBe('media-second');
  });
});

/**
 * What a refresh that failed is allowed to cost.
 *
 * The stored refresh token is the whole of a session between one load and the
 * next, and throwing it away is signing somebody out of their tent - possibly
 * while the alarm they are watching is still ringing. Only an answer that says
 * the session is gone may do that, and on this route the server says it with
 * 401 and with nothing else: a 500, a 502 from a proxy during a restart or a
 * request that never arrived say only that the minute was a bad one.
 */
describe('a refresh the server could not answer', () => {
  const stored = () => ({
    refreshToken: 'refresh-stored',
    refreshTokenUntil: Date.now() + 30 * DAY_MS,
    user: USER,
    sessionId: 'session-1',
    stayLoggedIn: true,
  });

  /** The refresh route answering one status, with a problem document as the API always sends one. */
  const answering = (status: number): void => {
    const problem = { status, code: 'down', title: 'Down', detail: 'The server is having a bad minute.', errors: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(problem), { status, headers: { 'Content-Type': 'application/json' } })),
    );
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('terp.session', JSON.stringify(stored()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the session through a 500, says the server could not be reached, and signs in again on the next try', async () => {
    answering(500);
    const { session } = await freshSession();

    await session.restore();

    expect(localStorage.getItem('terp.session')).not.toBeNull();
    expect(session.snapshot()).toMatchObject({ user: null, restored: true, unreachable: true });

    // The same token, once the server is back: no password is asked for.
    serve([triple('afterTheOutage', 30 * DAY_MS)]);
    await session.restore();

    expect(session.snapshot()).toMatchObject({ user: USER, unreachable: false });
    expect(session.snapshot().tokens?.userToken).toBe('user-afterTheOutage');
  });

  it('keeps it when nothing answered at all, rather than leaving the boot unfinished', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { session } = await freshSession();

    await expect(session.restore()).resolves.toBeUndefined();

    expect(localStorage.getItem('terp.session')).not.toBeNull();
    expect(session.snapshot()).toMatchObject({ user: null, restored: true, unreachable: true });
  });

  it('ends it on a 401, which is the one answer that says the session is gone', async () => {
    answering(401);
    const { session } = await freshSession();

    await session.restore();

    expect(localStorage.getItem('terp.session')).toBeNull();
    expect(sessionStorage.getItem('terp.session')).toBeNull();
    // Marked as ended, so the sign-in form it lands on says the session ran out.
    expect(session.snapshot()).toMatchObject({ user: null, restored: true, unreachable: false, ended: true });
  });

  it('leaves an open tab signed in when a renewal in the middle of a session hits a fault', async () => {
    serve([result('first', 30 * DAY_MS)]);
    const { session } = await freshSession();
    // Stays signed in, which is what a phone does and what leaves the token in local storage.
    await session.logIn({ email: 'you@example.com', password: 'secret', stayLoggedIn: true });

    answering(503);
    expect(await session.refresh(session.snapshot().tokens?.refreshToken)).toBeNull();

    expect(session.snapshot()).toMatchObject({ user: USER, unreachable: true });
    expect(session.snapshot().tokens?.refreshToken).toBe('refresh-first');
    expect(localStorage.getItem('terp.session')).not.toBeNull();
  });
});

/**
 * Whose answers the query cache holds.
 *
 * Every account asks the same questions - `['home']`, `['me']` - so the cache
 * is emptied whenever the account changes or the session ends, and the next
 * person is drawn nothing of the last one. A change that is not one of person -
 * a refresh, a server that could not be reached - keeps the answers.
 */
describe('the query cache across accounts', () => {
  const OTHER: SessionUser = { id: 'user-2', handle: 'other', isAdmin: false, isDemo: false };
  const DEMO: SessionUser = { id: 'demo', handle: 'demo', isAdmin: false, isDemo: true };

  const storedAs = (user: SessionUser, refreshToken: string) =>
    JSON.stringify({ refreshToken, refreshTokenUntil: Date.now() + 30 * DAY_MS, user, sessionId: `session-${user.id}`, stayLoggedIn: true });

  /** One answer with a status, as the refresh route gives it when it refuses or falls over. */
  const failing = (status: number): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status, code: 'x', title: 'x', detail: 'x', errors: [] }), { status })),
    );
  };

  /** A fresh store, signed in, with an answer of that account's in the cache. */
  const signedIn = async (extra: unknown[] = []) => {
    serve([result('first', 30 * DAY_MS), ...extra]);
    const { session } = await freshSession();
    const { queryClient } = await import('@/api/query-client');
    await session.logIn({ email: 'you@example.com', password: 'secret', stayLoggedIn: true });
    queryClient.setQueryData(['home'], 'the first account’s places');
    return { session, queryClient };
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is emptied on signing out, before the next account signs in', async () => {
    const { session, queryClient } = await signedIn([{}]);

    await session.logOut();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('is emptied when the demo replaces the session, which passes no sign-in page', async () => {
    const { session, queryClient } = await signedIn([{ ...triple('demo', 30 * DAY_MS), sessionId: 'session-demo', user: DEMO }]);

    await session.openDemo();

    expect(queryClient.getQueryData(['home'])).toBeUndefined();
  });

  it('is emptied when a refresh says the session is gone', async () => {
    const { session, queryClient } = await signedIn();

    failing(401);
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(queryClient.getQueryData(['home'])).toBeUndefined();
  });

  it('keeps the same account’s answers through a refresh and through a server that cannot be reached', async () => {
    const { session, queryClient } = await signedIn([triple('second', 30 * DAY_MS)]);

    await session.refresh(session.snapshot().tokens?.refreshToken);
    failing(503);
    await session.refresh(session.snapshot().tokens?.refreshToken);

    expect(queryClient.getQueryData(['home'])).toBe('the first account’s places');
  });

  it('is emptied when the session that comes back is somebody else’s, signed in from another tab meanwhile', async () => {
    const { session, queryClient } = await signedIn();
    failing(503);
    await session.refresh(session.snapshot().tokens?.refreshToken);

    localStorage.setItem('terp.session', storedAs(OTHER, 'refresh-other'));
    serve([triple('other', 30 * DAY_MS)]);
    await session.restore();

    expect(session.snapshot().user).toEqual(OTHER);
    expect(queryClient.getQueryData(['home'])).toBeUndefined();
  });

  it('leaves a public page’s answer alone when a stored session is refused at boot, since it held nobody’s', async () => {
    localStorage.setItem('terp.session', storedAs(USER, 'refresh-stored'));
    failing(401);
    const { session } = await freshSession();
    const { queryClient } = await import('@/api/query-client');
    queryClient.setQueryData(['public', 'grow', 'a-grow'], 'a public grow');

    await session.restore();

    expect(session.snapshot()).toMatchObject({ user: null, ended: true });
    expect(queryClient.getQueryData(['public', 'grow', 'a-grow'])).toBe('a public grow');
  });
});
