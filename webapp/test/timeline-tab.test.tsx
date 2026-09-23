import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '@/screens/Timeline';

// Which of the two sessions is looking, because the tab's empty state is the
// one thing on it that differs between them.
const who = vi.hoisted(() => ({ is: 'you' as 'you' | 'demo' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');
  const of = { you: SIGNED_IN, demo: ON_THE_DEMO };

  return { ...(await importOriginal<object>()), useSession: () => of[who.is] };
});

// A home with no place on it at all, which is the only state this tab can draw
// without a timeline behind it.
vi.mock('@/api/home', () => ({ useHome: () => ({ isPending: false, data: { spaces: [] }, refetch: () => {} }) }));

/**
 * The Timeline tab when the home draws nothing. The screen itself is covered by
 * timeline.test.tsx; what is asked here is who the empty state is addressed to.
 */
describe('the timeline tab with nothing to draw', () => {
  beforeAll(async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
    await i18next
      .use(initReactI18next)
      .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  });

  beforeEach(() => {
    who.is = 'you';
  });

  const draw = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Timeline />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('sends an account with no place yet to the home, where a device is added and a grow is started', () => {
    draw();

    expect(screen.getByText(/Add a device or start a grow/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  /**
   * The demo owns nothing and every write it makes is refused, so both of the
   * actions the other line names are shut to it; it used to be sent to the home
   * to take them anyway.
   */
  it('tells the demo that nothing was left in it, rather than asking it to add a device or start a grow', () => {
    who.is = 'demo';
    draw();

    expect(screen.getByText('The demo has nothing to draw; nothing has been left in this one to look at.')).toBeInTheDocument();
    expect(screen.queryByText(/Add a device or start a grow/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });
});
