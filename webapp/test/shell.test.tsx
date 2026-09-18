import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { TabBar } from '@/app/shell/TabBar';

/**
 * The bar is Home · Timeline · Log · Devices · Tasks, in that order, and every
 * caption comes out of the shipped catalogue - a key that is not in there shows
 * up here as its own name.
 */
describe('the tab bar', () => {
  beforeAll(async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
    await i18next
      .use(initReactI18next)
      .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  });

  it('has the five decided destinations in order', () => {
    render(
      <MemoryRouter>
        <TabBar />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Home', 'Timeline', 'Log', 'Devices', 'Tasks']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/', '/timeline', '/log', '/devices', '/tasks']);
  });
});
