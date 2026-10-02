import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Me } from '@fg2/shared-types/v1';
import { catchInstallPrompt } from '@/app/install';
import { InstallRow } from '@/screens/me/appearance/InstallRow';
import { PushCard } from '@/screens/notifications/Channels';

/**
 * The app on the home screen: the browser's own dialog where it offers one,
 * the steps where it does not, and on an iPhone the push card saying that push
 * arrives only there - with the way to the steps rather than "this browser
 * cannot".
 */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  catchInstallPrompt();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const draw = (node: React.ReactNode, at = '/me/appearance') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

const onIphone = () => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);

describe('putting the app on the home screen', () => {
  it('shows an iPhone the steps, unfolded where a link asked for them', () => {
    onIphone();
    draw(<InstallRow />, '/me/appearance#install');

    expect(screen.getByText(/Full-screen from its own icon - and on an iPhone/)).toBeInTheDocument();
    expect(screen.getByText(/tap the share icon/)).toBeInTheDocument();
    expect(screen.getByText(/switch push notifications on under Me › Notifications/)).toBeInTheDocument();
  });

  it('folds the steps away until asked, and shows the browser menu’s steps off an iPhone', () => {
    draw(<InstallRow />);

    expect(screen.queryByText(/Open the browser menu/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show how' }));
    expect(screen.getByText(/Open the browser menu/)).toBeInTheDocument();
  });

  it('installs in one tap where the browser offered its own dialog', async () => {
    const prompt = vi.fn(async () => undefined);
    const offered = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(offered);
    });
    draw(<InstallRow />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(offered.defaultPrevented).toBe(true);
    expect(await screen.findByText(/already running here as an app/)).toBeInTheDocument();
  });
});

describe('push on an iPhone', () => {
  const me = { pushPublicKey: 'key', pushSubscribed: false, notifications: { routing: {} } } as unknown as Me;

  it('says push arrives only in the app on the home screen, and links to the steps', () => {
    onIphone();
    draw(<PushCard me={me} held={false} />, '/me/notifications');

    expect(screen.getByText(/on an iPhone only in the app on the home screen/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to put it there ›' })).toHaveAttribute('href', '/me/appearance#install');
  });

  it('keeps the plain sentence for a browser that cannot push anywhere', () => {
    draw(<PushCard me={me} held={false} />, '/me/notifications');

    expect(screen.getByText(/this browser cannot receive push/)).toBeInTheDocument();
  });
});
