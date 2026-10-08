import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import { Appearance } from '@/screens/me/appearance/Appearance';
import { THEME_STORAGE_KEY } from '@/theme/theme-context';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { translate } from './translations';

/**
 * Me › Appearance: the theme and the language stay the browser's, the units
 * go to the account.
 *
 * The units are the thing to check on the wire: `PATCH /me` keeps every
 * preference a body leaves out, so one menu moved sends that one preference
 * and nothing it might send back stale - the units whole, as they are one. The
 * theme and the language are checked to land where they have always lived -
 * one attribute on <html>, one key in local storage - and nowhere near a
 * request.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const server = { me: meWith(), patched: [] as MeUpdate[], asked: [] as string[] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';
  server.asked.push(`${method} ${pathname}`);

  if (pathname === '/v1/me' && method === 'GET') return json(server.me);
  if (pathname === '/v1/me' && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as MeUpdate;
    server.patched.push(body);
    server.me = { ...server.me, ...body, preferences: { ...server.me.preferences, ...body.preferences } } as Me;
    return json(server.me);
  }
  // The German catalogue, as the language switch fetches it before switching.
  if (pathname === '/assets/i18n/de.json') return json({ me: { appearance: { title: 'Darstellung' } } });
  return json(NOT_FOUND, 404);
});

const draw = () =>
  drawAt(
    <ThemeProvider>
      <Appearance />
    </ThemeProvider>,
    { at: '/me/appearance' },
  );

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.me = meWith();
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

  it('sends the units with one changed and nothing else, so no other preference is turned back', async () => {
    draw();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Temperature' }), { target: { value: 'fahrenheit' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({ preferences: { units: { temperature: 'fahrenheit', weight: 'grams', volume: 'liters' } } });
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

/**
 * Whether the grow diary is offered is the account's too, so every device
 * agrees, and the answer can be taken back here once it was given on Start.
 * "Automatic" is no answer at all: the account's use decides.
 */
describe('the grow diary', () => {
  it('reads "automatic" where nobody has answered, and sends the answer alone', async () => {
    draw();

    const diary = await screen.findByRole('combobox', { name: 'Grow diary' });
    expect(diary).toHaveValue('auto');
    fireEvent.change(diary, { target: { value: 'off' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({ preferences: { diary: 'off' } });
  });

  it('hands the question back to the account´s use when "automatic" is chosen again', async () => {
    server.me = { ...meWith(), preferences: { ...meWith().preferences, diary: 'off' } };
    draw();

    const diary = await screen.findByRole('combobox', { name: 'Grow diary' });
    expect(diary).toHaveValue('off');
    fireEvent.change(diary, { target: { value: 'auto' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0].preferences?.diary).toBeNull();
  });
});

describe('the time zone', () => {
  it('draws the zone the account keeps and offers this device its own', async () => {
    server.me = { ...meWith(), preferences: { ...meWith().preferences, timezone: 'UTC' } };
    draw();

    const menu = await screen.findByRole('combobox', { name: 'Time zone' });
    expect(menu).toHaveValue('UTC');
    expect(screen.getByText(/quiet hours and every clock time the app draws are read in it/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Europe/Berlin' })).toBeInTheDocument();
  });

  it('keeps UTC on offer, which the browser does not list and the migration left every account on', async () => {
    draw();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Time zone' }), { target: { value: 'Asia/Tokyo' } });
    await waitFor(() => expect(server.patched).toHaveLength(1));

    expect(await screen.findByRole('option', { name: 'UTC' })).toBeInTheDocument();
  });

  it('sends the zone alone, so the units are not turned back', async () => {
    draw();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Time zone' }), { target: { value: 'America/New_York' } });

    await waitFor(() => expect(server.patched).toHaveLength(1));
    expect(server.patched[0]).toEqual({ preferences: { timezone: 'America/New_York' } });
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
