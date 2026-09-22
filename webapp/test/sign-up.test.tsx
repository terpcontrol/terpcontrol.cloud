import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitePreview, Problem, SessionResult, UserCreate } from '@fg2/shared-types/v1';
import { session } from '@/api/session';
import { JoinRoute } from '@/screens/join/JoinRoute';
import { SignIn } from '@/screens/SignIn';
import { SignUp } from '@/screens/SignUp';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The stranger's way through an invitation: from the link to an account of
 * their own and back into the tent, without ever meeting a sign-in form they
 * cannot get past.
 *
 * The session is the real one here rather than a mocked answer, because the
 * whole path is the session appearing halfway through it: the sign-up makes
 * the account, signs in with it, and the invitation page has to notice and
 * take the invitation up on its own. The fetch is stubbed by route, so what is
 * asserted is the order of writes that went on the wire.
 */

const NOW = DateTime.now();

const PREVIEW: InvitePreview = {
  isValid: true,
  spaceName: 'Blue Dream tent',
  spaceKind: 'tent',
  role: 'can_log',
  invitedByHandle: 'chris',
  expiresAt: NOW.plus({ days: 5 }).toISO()!,
};

const token = (hours: number) => ({ token: `token-${hours}`, validUntil: NOW.plus({ hours }).toISO()! });

const signedIn = (handle: string): SessionResult => ({
  userToken: token(1),
  refreshToken: token(24 * 30),
  mediaToken: token(24 * 30),
  sessionId: 'session-9',
  user: { id: 'user-9', handle, isAdmin: false, isDemo: false },
});

const refusal = (code: string, detail: string, status = 409): Problem => ({ status, code, title: 'Refused', detail, errors: [] });

const server = { active: true, refuseSignUp: null as Problem | null, wrote: [] as { method: string; path: string; body: unknown }[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') server.wrote.push({ method, path, body });

  if (method === 'GET' && path.startsWith('/invites/')) return json(PREVIEW);
  if (method === 'POST' && path === '/users') {
    if (server.refuseSignUp) return json(server.refuseSignUp, server.refuseSignUp.status);
    const asked = body as UserCreate;
    return json({ id: 'user-9', createdAt: NOW.toISO()!, email: asked.email, handle: asked.handle, isActive: server.active }, 201);
  }
  if (method === 'POST' && path === '/users/activations') return new Response(null, { status: 204 });
  if (method === 'POST' && path === '/sessions') return json(signedIn((body as { email: string }).email.split('@')[0]));
  if (method === 'POST' && path.endsWith('/acceptances')) return json({ membership: {}, space: { id: 'space-9' } }, 201);
  if (method === 'DELETE' && path.startsWith('/sessions/')) return new Response(null, { status: 204 });

  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

/** Where somebody lands once they are in: the tent's page, known here only by its id. */
function Landed() {
  const { spaceId } = useParams();
  return <p>Landed in {spaceId}</p>;
}

const draw = (at: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <Routes>
            <Route path="/join" element={<JoinRoute />} />
            <Route path="/join/:code" element={<JoinRoute />} />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/spaces/:spaceId/overview" element={<Landed />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const fillIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  server.active = true;
  server.refuseSignUp = null;
  server.wrote = [];
});

afterEach(async () => {
  await session.logOut();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the stranger an invitation was sent to', () => {
  it('is offered an account before a sign-in, and told in the invitation’s words what one takes', async () => {
    draw('/join/K7QZ4M2P');

    expect(await screen.findByText('You are invited to Blue Dream tent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account to join' })).toHaveAttribute('href', '/sign-up');
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByText(/You need an account of your own/)).toBeInTheDocument();
  });

  it('makes the account, signs in with it, comes back to the invitation and takes it up', async () => {
    draw('/join/K7QZ4M2P');
    fireEvent.click(await screen.findByRole('link', { name: 'Create an account to join' }));

    expect(await screen.findByText(/An invitation to Blue Dream tent is waiting/)).toBeInTheDocument();
    fillIn('Email', 'mara@example.com');
    fillIn('Username', '@mara');
    fillIn('Password', 'a long enough secret');
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));

    expect(await screen.findByText('Landed in space-9')).toBeInTheDocument();
    expect(server.wrote.map(write => `${write.method} ${write.path}`)).toEqual([
      'POST /users',
      'POST /sessions',
      'POST /invites/K7QZ4M2P/acceptances',
    ]);
    expect(server.wrote[0].body).toEqual({ email: 'mara@example.com', handle: 'mara', password: 'a long enough secret' });
    expect(server.wrote[1].body).toMatchObject({ email: 'mara@example.com', password: 'a long enough secret', stayLoggedIn: true });
  });

  it('says what happens next where the install activates an account first, and goes on once it is', async () => {
    server.active = false;
    draw('/join/K7QZ4M2P');
    fireEvent.click(await screen.findByRole('link', { name: 'Create an account to join' }));

    fillIn('Email', 'mara@example.com');
    fillIn('Username', 'mara');
    fillIn('Password', 'a long enough secret');
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));

    expect(await screen.findByText('One more step: activation')).toBeInTheDocument();
    expect(
      screen.getByText(/The account for mara@example.com exists, but this install activates an account before it may sign in/),
    ).toBeInTheDocument();
    expect(server.wrote.map(write => write.path)).toEqual(['/users']);

    fillIn('Activation code', ' 4f2c-code ');
    fireEvent.click(screen.getByRole('button', { name: 'Activate and continue' }));

    expect(await screen.findByText('Landed in space-9')).toBeInTheDocument();
    expect(server.wrote.map(write => `${write.method} ${write.path}`)).toEqual([
      'POST /users',
      'POST /users/activations',
      'POST /sessions',
      'POST /invites/K7QZ4M2P/acceptances',
    ]);
    expect(server.wrote[1].body).toEqual({ activationCode: '4f2c-code' });
  });

  it('shows the server’s own sentence when the address already has an account', async () => {
    server.refuseSignUp = refusal('email_taken', 'There is already an account with that address.');
    draw('/join/K7QZ4M2P');
    fireEvent.click(await screen.findByRole('link', { name: 'Create an account to join' }));

    fillIn('Email', 'mara@example.com');
    fillIn('Username', 'mara');
    fillIn('Password', 'a long enough secret');
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('There is already an account with that address.');
    expect(screen.getByRole('button', { name: 'Create the account' })).toBeInTheDocument();
  });

  it('can type a code that was read to them and reach the same invitation', async () => {
    draw('/join');

    fireEvent.change(await screen.findByLabelText('Invitation code'), { target: { value: ' k7qz-4m2p ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the invitation' }));

    expect(await screen.findByText('You are invited to Blue Dream tent')).toBeInTheDocument();
    expect(String(vi.mocked(fetchStub).mock.calls.at(-1)?.[0])).toMatch(/\/invites\/K7QZ4M2P$/);
  });
});

describe('the sign-in page', () => {
  it('offers the way to an account beside the way in', async () => {
    draw('/sign-in');

    expect(await screen.findByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/sign-up');
  });
});
