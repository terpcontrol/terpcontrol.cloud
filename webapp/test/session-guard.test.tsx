import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTokens, SessionUser } from '@fg2/shared-types/v1';
import { DAY_MS, MINUTE_MS } from '@/ui/days';
import { json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { translate } from './translations';

/**
 * What stands in front of the screens while the stored session is being checked.
 *
 * The case this is about is an API that is restarting: the app itself is
 * precached and loads, the refresh it makes on the way in is answered 503, and
 * what the person must not be told is that they are signed out - their tent is
 * on the other side of that screen and the alarm they were reading may still be
 * ringing. So the page says the server could not be reached, keeps the session,
 * and the same tap that would have been a password gets them back in.
 *
 * And what it remembers of where somebody was going, which is the whole address:
 * a link out of an alert or shared to a colleague carries its subject in the
 * query, so a round trip through the form that kept only the path would land on
 * the right screen with nothing on it.
 */

const USER: SessionUser = { id: 'user-1', handle: 'you', isAdmin: false, isDemo: false };

const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

const TOKENS: SessionTokens = {
  userToken: { token: 'user-1', validUntil: at(5 * MINUTE_MS) },
  refreshToken: { token: 'refresh-2', validUntil: at(30 * DAY_MS) },
  mediaToken: { token: 'media-1', validUntil: at(30 * DAY_MS) },
};

const answering = (status: number, body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(body, status)),
  );
};

/** A stored session the server refuses, and a password it accepts: what following a link while signed out is. */
const answeringSignedOut = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sessions/refresh')) {
        return json({ status: 401, code: 'unauthenticated', title: 'Gone', detail: 'Spent.', errors: [] }, 401);
      }

      return json({ ...TOKENS, sessionId: 'session-2', user: USER });
    }),
  );
};

/** Stands where the screen behind the guard would, and says which address it was drawn at. */
function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

/** The guard and the store it reads, both fresh: the store is a module-level singleton. */
const freshGuard = async () => {
  vi.resetModules();
  const { RequireSession } = await import('@/app/RequireSession');
  const { session } = await import('@/api/session');
  // Imported after the same reset, so the form and the guard read one store.
  const { SignIn } = await import('@/screens/SignIn');
  const { queryClient } = await import('@/api/query-client');
  return { RequireSession, session, SignIn, queryClient };
};

beforeAll(() => translate());

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
  vi.unstubAllGlobals();
});

describe('a boot while the API is restarting', () => {
  it('says the server could not be reached, keeps the session, and lets the same page in once it answers', async () => {
    answering(503, { status: 503, code: 'down', title: 'Down', detail: 'The server is restarting.', errors: [] });
    const { RequireSession, queryClient } = await freshGuard();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <RequireSession>
            <p>the tent</p>
          </RequireSession>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Could not reach the server' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You are still signed in');
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText('the tent')).not.toBeInTheDocument();
    expect(localStorage.getItem('terp.session')).not.toBeNull();

    answering(200, TOKENS);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('the tent')).toBeInTheDocument();
  });
});

describe('a deep link followed while the session is gone', () => {
  it('signs in and lands on the address that was asked for, query and hash and all', async () => {
    answeringSignedOut();
    const { RequireSession, SignIn, queryClient } = await freshGuard();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/charts?grow=grow-1&range=grow#vpd']}>
          <Routes>
            <Route
              path="/charts"
              element={
                <RequireSession>
                  <Landed />
                </RequireSession>
              }
            />
            <Route path="/sign-in" element={<SignIn />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The stored token was refused, so this really is the sign-in form and not
    // the "could not reach" page, which keeps the session and never asks.
    const button = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'you@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough secret' } });
    fireEvent.click(button);

    expect(await screen.findByTestId('landed')).toHaveTextContent('/charts?grow=grow-1&range=grow#vpd');
  });
});

describe('the demo opened over a signed-in session', () => {
  /** A screen that reads the home, as every screen behind the guard reads something. */
  function Places() {
    const home = useQuery({ queryKey: ['home'], queryFn: async () => 'the demo’s places' });
    return <p data-testid="places">{home.data ?? 'loading'}</p>;
  }

  it('draws the screens anew, so nothing read for the grower stays on screen for the demo', async () => {
    answering(200, TOKENS);
    const { RequireSession, session, queryClient } = await freshGuard();
    await session.restore();
    queryClient.setQueryData(['home'], 'the grower’s places');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <RequireSession>
            <Places />
          </RequireSession>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('places')).toHaveTextContent('the grower’s places');

    answering(200, { ...TOKENS, sessionId: 'session-demo', user: { id: 'demo', handle: 'demo', isAdmin: false, isDemo: true } });
    await act(() => session.openDemo());

    expect(screen.getByTestId('places')).not.toHaveTextContent('the grower’s places');
    expect(await screen.findByText('the demo’s places')).toBeInTheDocument();
  });
});

/**
 * Terms of use that are new to an account - published, or changed, after it
 * accepted any - stand in front of every screen until they are accepted, and
 * only the terms the server names are accepted: a tab left open while they
 * changed again reads the new ones first.
 */
describe('terms of use that are new to the account', () => {
  const TERMS = 'https://example.test/terms?stand=2026-11';
  const NEWER = 'https://example.test/terms?stand=2026-12';

  const server = { terms: TERMS as string | null, inForce: TERMS, accepted: [] as string[], askedForMe: 0 };

  const answeringWithTerms = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/sessions/refresh')) return json(TOKENS);
        if (url.endsWith('/me/terms-acceptances')) {
          const asked = (JSON.parse(String(init?.body)) as { url: string }).url;
          if (asked !== server.inForce) {
            return json(
              { status: 409, code: 'terms_changed', title: 'Conflict', detail: 'These are not the terms of use in force any more.', errors: [] },
              409,
            );
          }
          server.accepted.push(asked);
          server.terms = null;
          return json(meWith({ termsToAccept: null }));
        }
        if (url.endsWith('/me')) {
          server.askedForMe += 1;
          return json(meWith({ termsToAccept: server.terms }));
        }
        return json(NOT_FOUND, 404);
      }),
    );
  };

  beforeEach(() => {
    Object.assign(server, { terms: TERMS, inForce: TERMS, accepted: [], askedForMe: 0 });
    answeringWithTerms();
  });

  const drawGuarded = async () => {
    const { RequireSession, queryClient } = await freshGuard();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <RequireSession>
            <p>the tent</p>
          </RequireSession>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('are asked for before anything else, with being of age, and the screens follow once they are accepted', async () => {
    await drawGuarded();

    expect(await screen.findByRole('heading', { name: 'New terms of use' })).toBeInTheDocument();
    expect(screen.queryByText('the tent')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'terms of use' })).toHaveAttribute('href', TERMS);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByText('Please confirm that you are at least 18 and accept the terms of use.')).toBeInTheDocument();
    expect(server.accepted).toEqual([]);

    fireEvent.click(screen.getByRole('checkbox', { name: /I am at least 18 years old/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));

    expect(await screen.findByText('the tent')).toBeInTheDocument();
    expect(server.accepted).toEqual([TERMS]);
  });

  it('are read anew where they changed again while the page stood open', async () => {
    await drawGuarded();
    await screen.findByRole('heading', { name: 'New terms of use' });
    server.terms = NEWER;
    server.inForce = NEWER;

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'terms of use' })).toHaveAttribute('href', NEWER));
    expect(screen.getByRole('alert')).toHaveTextContent('These are not the terms of use in force any more.');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(server.accepted).toEqual([]);
  });

  it('are never asked of the demo, which has no account to ask', async () => {
    localStorage.setItem(
      'terp.session',
      JSON.stringify({
        refreshToken: 'refresh-1',
        refreshTokenUntil: Date.now() + 30 * DAY_MS,
        user: { id: 'demo', handle: 'demo', isAdmin: false, isDemo: true },
        sessionId: 'session-demo',
        stayLoggedIn: true,
      }),
    );
    await drawGuarded();

    expect(await screen.findByText('the tent')).toBeInTheDocument();
    expect(server.askedForMe).toBe(0);
  });
});
