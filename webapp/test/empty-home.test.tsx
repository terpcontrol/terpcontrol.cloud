import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyHome } from '@/screens/EmptyHome';

// Every door here depends on who is looking, so there has to be somebody: the
// demo may read the whole account and write nothing to it, and a door that
// ended in a refusal would be a door drawn for nobody.
const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
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

  beforeEach(() => {
    who.demo = false;
  });

  const draw = (onStartGrow: () => void = () => undefined) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EmptyHome onStartGrow={onStartGrow} />
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

  it('shows the demo why it cannot add hardware instead of a field it would be refused', () => {
    who.demo = true;
    draw();
    const card = screen.getByRole('heading', { name: 'Add a device' }).closest('article')!;

    expect(within(card).queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'scan QR' })).not.toBeInTheDocument();
    expect(within(card).getByText(/cannot claim hardware/)).toBeInTheDocument();
  });

  it('does not offer the demo a second demo to open', () => {
    who.demo = true;
    draw();

    expect(screen.queryByRole('heading', { name: 'Try the demo' })).not.toBeInTheDocument();
  });
});
