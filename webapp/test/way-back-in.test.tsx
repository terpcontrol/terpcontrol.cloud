import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DevicePage, Problem } from '@fg2/shared-types/v1';
import { LinkEnded, OldDevice, OldLogin } from '@/app/OldAddresses';
import { session } from '@/api/session';
import { Activate } from '@/screens/Activate';
import { Recover } from '@/screens/Recover';
import { SignIn } from '@/screens/SignIn';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The ways back into an account that the old app had and the rewrite had not:
 * a forgotten password, an activation code, and the addresses the old app's
 * mails, bookmarks and shared links carry. The fetch is stubbed by route, so
 * what is asserted is what went on the wire and where the reader lands.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string): Problem => ({ status, code, title: 'Refused', detail: '', errors: [] });

const server = { wrote: [] as { method: string; path: string; body: unknown }[], redeem: 204, activate: 204, devices: [] as Device[] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
  if (method !== 'GET') server.wrote.push({ method, path, body });

  if (method === 'POST' && path === '/password-resets') return new Response(null, { status: 202 });
  if (method === 'POST' && path.endsWith('/redemptions'))
    return server.redeem === 204 ? new Response(null, { status: 204 }) : json(problem(404, 'reset_unknown'), 404);
  if (method === 'POST' && path === '/users/activations')
    return server.activate === 204 ? new Response(null, { status: 204 }) : json(problem(404, 'activation_unknown'), 404);
  if (method === 'POST' && path === '/sessions/refresh') return json(problem(401, 'session_gone'), 401);
  if (method === 'GET' && path.startsWith('/devices')) return json({ items: server.devices, nextCursor: null } satisfies DevicePage);

  return json(problem(404, 'not_found'), 404);
}) as unknown as typeof fetch;

/** Where the reader ended up, and what the page that sent them there handed over. */
function Landed() {
  const location = useLocation();
  return (
    <p>
      Landed on {location.pathname}
      {location.search} {JSON.stringify(location.state)}
    </p>
  );
}

const draw = (at: string | { pathname: string; state: unknown }) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/recover" element={<Recover />} />
            <Route path="/recover/:token" element={<Recover />} />
            <Route path="/activate" element={<Activate />} />
            <Route path="/activate/:code" element={<Activate />} />
            <Route path="/login" element={<OldLogin />} />
            <Route path="/device/:deviceId/:page?" element={<OldDevice />} />
            <Route path="/link-expired" element={<LinkEnded />} />
            <Route path="*" element={<Landed />} />
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
  server.wrote = [];
  server.redeem = 204;
  server.activate = 204;
  server.devices = [];
});

afterEach(async () => {
  await session.logOut();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('a forgotten password', () => {
  it('is a link under the password that carries the address already typed', async () => {
    draw('/sign-in');
    fillIn('Email', 'you@example.com');
    fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));

    expect(await screen.findByLabelText('Email')).toHaveValue('you@example.com');
  });

  it('asks for the mail and says it is on its way, whether or not the address has an account', async () => {
    draw({ pathname: '/recover', state: { email: 'you@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send mail' }));

    expect(await screen.findByRole('status')).toHaveTextContent('If you@example.com has an account here, a mail is on its way');
    expect(server.wrote).toEqual([{ method: 'POST', path: '/password-resets', body: { email: 'you@example.com' } }]);
  });

  it('takes the code typed from the mail and goes on as the link would', async () => {
    draw('/recover');
    fireEvent.click(screen.getByRole('button', { name: 'I already have a code' }));
    fillIn('Code from the mail', ' 1b2c-code ');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  });

  it('sets the new password with the token and sends the reader to sign in with it', async () => {
    draw('/recover/tok-1');
    fillIn('New password', 'a new secret');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been changed. Sign in with it now.');
    expect(server.wrote).toEqual([{ method: 'POST', path: '/password-resets/tok-1/redemptions', body: { password: 'a new secret' } }]);
  });

  it('says a spent link is spent, with the way to a new one', async () => {
    server.redeem = 404;
    draw('/recover/tok-old');
    fillIn('New password', 'a new secret');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('has been used already or has run out');
    expect(screen.getByRole('link', { name: 'Ask for a new mail' })).toHaveAttribute('href', '/recover');
  });
});

describe('an activation code', () => {
  it('arrives filled in from the mail’s link, and activates on the tap rather than on arrival', async () => {
    draw('/activate/code-7');

    expect(screen.getByLabelText('Activation code')).toHaveValue('code-7');
    expect(server.wrote).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your account is active. Sign in now.');
    expect(server.wrote).toEqual([{ method: 'POST', path: '/users/activations', body: { activationCode: 'code-7' } }]);
  });

  it('says a code it does not know in a sentence that points to signing in', async () => {
    server.activate = 404;
    draw('/activate');
    fillIn('Activation code', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('If your account is already active, just sign in.');
  });
});

describe('the old app’s addresses', () => {
  it('send a recovery and an activation link from an old mail to the pages that take them', async () => {
    const { unmount } = draw('/login?recovery=tok-9');
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    unmount();

    draw('/login?code=code-9');
    expect(await screen.findByLabelText('Activation code')).toHaveValue('code-9');
  });

  it('send a plain old sign-in to the sign-in', async () => {
    draw('/login');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('answer a link shared from the old app with a page that says it ended with the move', () => {
    draw('/device/sim-fridge-1/charts?share=abc');

    expect(screen.getByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
    expect(screen.getByText(/moved to a new app/)).toBeInTheDocument();
  });

  it('answer the old "link expired" page the same way', () => {
    draw('/link-expired');
    expect(screen.getByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
  });
});
