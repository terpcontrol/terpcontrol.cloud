import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeUpdate } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { Appearance } from '@/screens/me/appearance/Appearance';
import { THEME_STORAGE_KEY } from '@/theme/theme-context';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Me › Appearance: the theme is the browser's, the language the browser's
 * choice - and each line says where it holds. Both are checked to land where
 * they live - one attribute on <html>, one key in local storage - and nowhere
 * near a request of this page: the account hears the language from the shell.
 * Units are not offered while no view converts them.
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
  if (pathname === '/assets/i18n/de.json') {
    return json({
      me: { appearance: { title: 'Darstellung', language: 'Sprache', languageNames: { de: 'Deutsch' } }, saved: { setting: '{{what}}: {{value}}' } },
    });
  }
  return json(NOT_FOUND, 404);
});

const told: Told[] = [];

const draw = () =>
  drawAt(
    <ThemeProvider>
      <Toast told={told}>
        <Appearance />
      </Toast>
    </ThemeProvider>,
    { at: '/me/appearance' },
  );

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  told.length = 0;
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
  it('is three segments that write one attribute on <html> and touch no request, and says it holds in this browser', () => {
    draw();

    expect(screen.getByText('in this browser only')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(server.asked.filter(call => call.startsWith('PATCH'))).toEqual([]);
  });
});

describe('the units', () => {
  it('are not offered while no view converts them, and nothing about them is sent', () => {
    draw();

    expect(screen.queryByText('Units')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '°F' })).not.toBeInTheDocument();
    expect(server.asked.filter(call => call.includes('/v1/me'))).toEqual([]);
  });

  it('leave the demo the settings of this browser', () => {
    session.demo = true;
    draw();

    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(server.asked.filter(call => call.includes('/v1/'))).toEqual([]);
  });
});

describe('the language', () => {
  it('offers each language in its own name, switches the catalogue, and keeps the choice in this browser', async () => {
    draw();

    const menu = screen.getByRole('combobox', { name: 'Language' });
    expect(menu).toHaveValue('en');
    expect(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
    expect(screen.getByText('here and in any browser without a choice of its own')).toBeInTheDocument();

    fireEvent.change(menu, { target: { value: 'de' } });

    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(localStorage.getItem('terp.language')).toBe('de');
    expect(await screen.findByRole('heading', { name: 'Darstellung' })).toBeInTheDocument();
    expect(server.asked.filter(call => call.startsWith('PATCH'))).toEqual([]);
  });

  it('answers the change in the language chosen, with the way back to the one before', async () => {
    draw();

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'de' } });
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Sprache: Deutsch']));

    // Taken back, the toast answers in the language gone back to, not with the German line under an English word.
    const back = told[0] as Extract<Told, { undone: string }>;
    expect(back.undone).toBe('Language: English');
    await back.undo();

    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('terp.language')).toBe('en');
    expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });
});
