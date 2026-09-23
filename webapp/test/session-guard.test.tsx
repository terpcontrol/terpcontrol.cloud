import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
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

/** The guard and the store it reads, both fresh: the store is a module-level singleton. */
const freshGuard = async () => {
  vi.resetModules();
  const { RequireSession } = await import('@/app/RequireSession');
  const { session } = await import('@/api/session');
  return { RequireSession, session };
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
