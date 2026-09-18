import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TabBar } from '@/app/shell/TabBar';
import { LogProvider } from '@/log/LogProvider';

// What a card offers depends on who is looking, so a test says who that is.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * The bar is Home · Timeline · Log · Devices · Tasks, in that order, and every
 * caption comes out of the shipped catalogue - a key that is not in there shows
 * up here as its own name.
 *
 * Four of the five are places. The raised one is not: it opens the sheet over
 * whatever is showing, so it is a button and goes nowhere.
 */
describe('the tab bar', () => {
  beforeAll(async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
    await i18next
      .use(initReactI18next)
      .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  });

  it('has the five decided destinations in order, with Log as an action rather than a place', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <LogProvider>
            <TabBar />
          </LogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const tabs = [...container.querySelectorAll('nav > *')];
    expect(tabs.map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Log', 'Devices', 'Tasks']);

    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/', '/timeline', '/devices', '/tasks']);
    expect(screen.getByRole('button', { name: 'Log' })).toBeInTheDocument();
  });
});
