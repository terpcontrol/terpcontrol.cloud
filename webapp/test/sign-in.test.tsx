import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Problem } from '@fg2/shared-types/v1';
import { session } from '@/api/session';
import { SignIn } from '@/screens/SignIn';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * What the sign-in card says when it is turned away.
 *
 * The password and the address are the one thing the card must not name
 * wrongly: somebody told to check them will go and change them. So each of the
 * server's refusals is asserted here by the sentence it reaches the grower as,
 * with the session store and its fetch left real and only the answer stubbed,
 * because the sentence is chosen from what came back on the wire.
 */

const problem = (status: number, code: string, detail: string): Problem => ({ status, code, title: 'Refused', detail, errors: [] });

const refusal = { body: problem(401, 'credentials_wrong', 'That is not an address and password of an account here.') };

const fetchStub = vi.fn(
  async () => new Response(JSON.stringify(refusal.body), { status: refusal.body.status, headers: { 'Content-Type': 'application/json' } }),
) as unknown as typeof fetch;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/sign-in']}>
        <ThemeProvider>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Fill the form in with credentials that are right, and ask. */
const signIn = (email = 'Email', password = 'Password', button = 'Sign in') => {
  fireEvent.change(screen.getByLabelText(email), { target: { value: 'you@example.com' } });
  fireEvent.change(screen.getByLabelText(password), { target: { value: 'a long enough secret' } });
  fireEvent.click(screen.getByRole('button', { name: button }));
};

beforeAll(async () => {
  const [en, de] = await Promise.all(
    ['en', 'de'].map(async language => JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8'))),
  );
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, de: { translation: de } },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  refusal.body = problem(401, 'credentials_wrong', 'That is not an address and password of an account here.');
});

afterEach(async () => {
  await i18next.changeLanguage('en');
  await session.logOut();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('a sign-in the server refuses', () => {
  it('says the attempts were too many, not the password wrong, when the server answered 429', async () => {
    refusal.body = problem(429, 'too_many_requests', 'Too many sign-in attempts, please try again later.');
    draw();

    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts. Please wait a moment and try again.');
    expect(screen.queryByText(/check your e-mail and password/)).not.toBeInTheDocument();
  });

  it('says it in German too, rather than in the server’s English', async () => {
    refusal.body = problem(429, 'too_many_requests', 'Too many sign-in attempts, please try again later.');
    await i18next.changeLanguage('de');
    draw();

    signIn('E-Mail', 'Passwort', 'Anmelden');

    expect(await screen.findByRole('alert')).toHaveTextContent('Zu viele Anmeldeversuche. Bitte einen Moment warten und es erneut versuchen.');
  });

  // A proxy in front of the API counts its own budget and answers HTML, so the
  // status line is all there is to read; it is still a 429 and still not a
  // password that was typed wrongly.
  it('says the same when the 429 came back as something other than a problem document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Too Many Requests</html>', { status: 429, statusText: 'Too Many Requests' })),
    );
    draw();

    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts. Please wait a moment and try again.');
  });

  it('keeps naming the two fields where they really are what was wrong', async () => {
    draw();

    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in. Please check your e-mail and password.');
    expect(screen.queryByText(/not an address and password of an account here/)).not.toBeInTheDocument();
  });

  it('hands an account that is not activated the server’s own sentence, which names the address', async () => {
    refusal.body = problem(403, 'account_not_activated', 'This account is not activated yet. The code was sent to you@example.com.');
    draw();

    signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('The code was sent to you@example.com.');
  });
});
