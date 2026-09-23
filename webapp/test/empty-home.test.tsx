import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '@/api/session';
import { EmptyHome } from '@/screens/EmptyHome';

// Every door here depends on who is looking, so there has to be somebody: the
// demo has nothing of its own to be shown, and a session on its way out may
// write nothing, so a door that ended in a refusal would be a door drawn for
// nobody. Nobody at all is what a session being ended under the screen looks
// like for the render that still happens before the wall sends it away.
const who = vi.hoisted(() => ({ is: 'you' as 'you' | 'demo' | 'nobody' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO, SIGNED_OUT } = await import('./session');
  const of = { you: SIGNED_IN, demo: ON_THE_DEMO, nobody: SIGNED_OUT };

  return { ...(await importOriginal<object>()), useSession: () => of[who.is] };
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
    who.is = 'you';
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

  /**
   * A demo session owns whatever an operator has put in the demo, so a demo
   * that owns no space is a demo with nothing in it. It used to be handed the
   * first-run copy written for somebody's own brand-new account and told to set
   * up hardware it may not claim.
   */
  it('tells the demo that the demo is empty rather than offering it a grower first run', () => {
    who.is = 'demo';
    draw();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The demo is empty.');
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start a grow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a device' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
  });

  /** /sign-in sends a session that already exists straight back, so the one door out has to end this one first. */
  it('offers the demo its own account, and ends the demo session to get there', async () => {
    who.is = 'demo';
    const out = vi.spyOn(session, 'logOut').mockResolvedValue(undefined as never);
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with my own account' }));
    await waitFor(() => expect(out).toHaveBeenCalledTimes(1));
  });

  it('shows a session that may not write why it cannot add hardware, instead of a field it would be refused', () => {
    who.is = 'nobody';
    draw();
    const card = screen.getByRole('heading', { name: 'Add a device' }).closest('article')!;

    expect(within(card).queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'scan QR' })).not.toBeInTheDocument();
    expect(within(card).getByText(/cannot claim hardware/)).toBeInTheDocument();
  });

  /** The third door is not the same kind of door as the two above it: it signs out of the account just made. */
  it('says what the demo costs, and asks before it takes it', async () => {
    const opened = vi.spyOn(session, 'openDemo').mockResolvedValue(undefined as never);
    draw();

    expect(screen.getByText(/signed out of yours/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: 'Try the demo' }).closest('button')!);
    expect(opened).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stay in my account' }));
    expect(screen.queryByRole('button', { name: /sign out of mine/ })).not.toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('heading', { name: 'Try the demo' }).closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /sign out of mine/ }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });

  it('says the camera was refused rather than letting the overlay vanish', async () => {
    vi.stubGlobal('BarcodeDetector', class {});
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) } });

    draw();
    fireEvent.click(screen.getByRole('button', { name: 'scan QR' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The camera was not allowed');
    vi.unstubAllGlobals();
  });

  it('does not offer the demo a second demo to open', () => {
    who.is = 'demo';
    draw();

    expect(screen.queryByRole('heading', { name: 'Try the demo' })).not.toBeInTheDocument();
  });
});
