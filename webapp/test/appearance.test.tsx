import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { Appearance } from '@/screens/me/appearance/Appearance';
import { THEME_STORAGE_KEY } from '@/theme/theme-context';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * Me › Appearance: the theme and the language stay the browser's, the units
 * go to the account.
 *
 * The units are the thing to check on the wire: `PATCH /me` replaces the
 * preferences object it is given, so one menu moved has to send the other two
 * units, the locale and the time zone back exactly as they were read. The
 * theme and the language are checked to land where they have always lived -
 * one attribute on <html>, one key in local storage - and nowhere near a
 * request.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

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
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  retention: { climateDays: null },
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
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
    server.me = { ...server.me, ...body } as Me;
    return json(server.me);
  }
  // The German catalogue, as the language switch fetches it before switching.
  if (pathname === '/assets/i18n/de.json') return json({ me: { appearance: { title: 'Darstellung' } } });
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/appearance']}>
        <ThemeProvider>
          <Appearance />
        </ThemeProvider>
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
  session.demo = false;
  server.me = me();
  server.patched = [];
  server.asked = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem('terp.language');
  document.documentElement.removeAttribute('data-theme');
  await i18next.changeLanguage('en');
});

describe('the theme', () => {
  it('is three segments that write one attribute on <html> and touch no request', () => {
    draw();

    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(server.asked.filter(call => call.startsWith('PATCH'))).toEqual([]);
  });
});

describe('the units', () => {
  it('draws what the account states, in symbols', async () => {
    draw();

    expect(await screen.findByRole('combobox', { name: 'Temperature' })).toHaveValue('celsius');
    expect(screen.getByRole('combobox', { name: 'Weight' })).toHaveValue('grams');
    expect(screen.getByRole('combobox', { name: 'Volume' })).toHaveValue('liters');
    expect(screen.getByRole('option', { name: '°F' })).toBeInTheDocument();
  });

  it('sends the whole preferences object with one unit changed, so nothing else is turned back', async () => {
    draw();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Temperature' }), { target: { value: 'fahrenheit' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({
      preferences: { units: { temperature: 'fahrenheit', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
    });
  });

  it('are not offered to the demo, which is told why instead', () => {
    session.demo = true;
    draw();

    expect(screen.queryByRole('combobox', { name: 'Temperature' })).not.toBeInTheDocument();
    expect(screen.getByText('The demo has no account of its own, so there is nothing of it to change.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(server.asked.filter(call => call.includes('/v1/'))).toEqual([]);
  });
});

describe('the language', () => {
  it('offers each language in its own name and switches the catalogue, remembering the choice in this browser', async () => {
    draw();

    const menu = screen.getByRole('combobox', { name: 'Language' });
    expect(menu).toHaveValue('en');
    expect(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();

    fireEvent.change(menu, { target: { value: 'de' } });

    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(localStorage.getItem('terp.language')).toBe('de');
    expect(await screen.findByRole('heading', { name: 'Darstellung' })).toBeInTheDocument();
    expect(server.asked.filter(call => call.startsWith('PATCH'))).toEqual([]);
  });
});
