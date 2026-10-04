import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTokens, SessionUser } from '@fg2/shared-types/v1';

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

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

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
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  );
};

/** A stored session the server refuses, and a password it accepts: what following a link while signed out is. */
const answeringSignedOut = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sessions/refresh')) {
        return new Response(JSON.stringify({ status: 401, code: 'unauthenticated', title: 'Gone', detail: 'Spent.', errors: [] }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ...TOKENS, sessionId: 'session-2', user: USER }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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
  return { RequireSession, session, SignIn };
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

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
    const { RequireSession } = await freshGuard();

    render(
      <MemoryRouter initialEntries={['/']}>
        <RequireSession>
          <p>the tent</p>
        </RequireSession>
      </MemoryRouter>,
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
    const { RequireSession, SignIn } = await freshGuard();

    render(
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
      </MemoryRouter>,
    );

    // The stored token was refused, so this really is the sign-in form and not
    // the "could not reach" page, which keeps the session and never asks.
    const button = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'you@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough secret' } });
    fireEvent.click(button);

    expect(await screen.findByTestId('landed')).toHaveTextContent('/charts?grow=grow-1&range=grow#vpd');
  });
});
