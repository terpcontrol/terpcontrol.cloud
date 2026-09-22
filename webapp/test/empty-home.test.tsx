import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EmptyHome } from '@/screens/EmptyHome';

// The first door opens the new-grow sheet, and whether it is offered at all
// depends on who is looking, so there has to be somebody.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * The home before a grower has anything: a grow first, a device second, the
 * demo third, and the third one drawn as the lesser option.
 */
describe('the empty home', () => {
  beforeAll(async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
    await i18next
      .use(initReactI18next)
      .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  });

  const draw = (onStartGrow: () => void = () => undefined) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EmptyHome claimed={null} onClaimed={() => undefined} onStartGrow={onStartGrow} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('offers the three doors in the decided order', () => {
    draw();
    const cards = screen.getAllByRole('heading', { level: 2 });
    expect(cards.map(card => card.textContent)).toEqual(['Start a grow', 'Add a device', 'Try the demo']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nothing here yet.');
  });

  it('draws the demo as the dashed card', () => {
    draw();
    const demo = screen.getByRole('heading', { name: 'Try the demo' }).closest('article');
    const grow = screen.getByRole('heading', { name: 'Start a grow' }).closest('article');
    expect(demo?.className).toMatch(/cardDashed/);
    expect(grow?.className).not.toMatch(/cardDashed/);
  });

  it('asks the home for the new-grow sheet rather than holding it itself', () => {
    const start = vi.fn();
    draw(start);
    fireEvent.click(screen.getByRole('button', { name: /New grow/ }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('has the claim-code field with its scan option', () => {
    draw();
    const card = screen.getByRole('heading', { name: 'Add a device' }).closest('article')!;
    expect(within(card).getByRole('textbox', { name: 'Claim code' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /or scan/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'scan QR' })).toBeInTheDocument();
  });
});
