import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { createBrowserRouter, createMemoryRouter, Link, matchRoutes, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { router as appRouter, screens, SESSION_ROUTE } from '@/app/routes';
import { DevicePage } from '@/screens/devices/DevicePage';
import { forgetKept } from '@/ui/kept';
import { PageHead } from '@/ui/PageHead';
import { deviceWith } from './fixtures';
import { testClient } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * The arrow in the head of a page reached from another, and the addresses
 * around a device that name nothing: reached inside the app the arrow steps
 * back - no new entry, the page before as it was left - and on a page opened
 * by its address it leads to the page that one stands under.
 *
 * Drawn in a router on the window's own history, since that is what the arrow
 * asks: a memory router keeps no entries there, and every page in one is a
 * page opened by its address.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

vi.mock('@/log/log-context', async importOriginal => ({ ...(await importOriginal<object>()), useLog: () => ({ tell: () => undefined }) }));
vi.mock('@/screens/control/lead', () => ({ useLeads: () => true }));

const head = (title: string, to: string, label: string) => <PageHead title={title} back={{ to, label }} />;

const PAGES = [
  {
    path: '/control',
    element: (
      <>
        <h1>Control</h1>
        <Link to="/devices/x">All about the controller</Link>
      </>
    ),
  },
  {
    path: '/devices/x',
    element: (
      <>
        {head('Controller', '/control', 'Back to Control')}
        <Link to="/devices/x/details">Technical details</Link>
      </>
    ),
  },
  { path: '/devices/x/details', element: head('Technical details', '/devices/x', 'Back to Controller') },
];

/** The window's own scroll, which jsdom neither keeps nor moves. */
const scrolled = { to: vi.fn<(x: number, y: number) => void>() };
const scrollTo = (y: number) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  fireEvent.scroll(window);
};

/** The routers opened by a test, each of which listens to the window's history until it is let go of. */
const opened: { dispose: () => void }[] = [];

/** The app opened at `at`, as a browser opens an address: one entry, and none of the app's before it. */
const openAt = (at: string, pages = PAGES) => {
  window.history.replaceState(null, '', at);
  const router = createBrowserRouter(pages);
  opened.push(router);
  render(
    <QueryClientProvider client={testClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

const at = () => window.location.pathname;

beforeAll(() => translate());

beforeEach(() => {
  forgetKept();
  scrolled.to.mockReset();
  scrolled.to.mockImplementation((_x, y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true }));
  window.scrollTo = scrolled.to as unknown as typeof window.scrollTo;
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => {
  cleanup();
  for (const router of opened.splice(0)) router.dispose();
});

describe('the arrow in the head of a page', () => {
  it('leads a page opened by its address to the page it stands under, and that one on to its own', async () => {
    openAt('/devices/x/details');

    const arrow = screen.getByRole('link', { name: 'Back to Controller' });
    expect(arrow).toHaveAttribute('href', '/devices/x');
    fireEvent.click(arrow);

    expect(await screen.findByRole('heading', { name: 'Controller' })).toBeInTheDocument();
    expect(at()).toBe('/devices/x');
    // A step back from here would only lead down again, to the page the arrow came from: this one leads on up.
    fireEvent.click(screen.getByRole('link', { name: 'Back to Control' }));
    expect(await screen.findByRole('heading', { name: 'Control' })).toBeInTheDocument();
    expect(at()).toBe('/control');
  });

  it('steps back again from a page opened below one the arrow led up to', async () => {
    openAt('/devices/x/details');
    fireEvent.click(screen.getByRole('link', { name: 'Back to Controller' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Technical details' }));
    await screen.findByRole('heading', { name: 'Technical details' });
    const entries = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));

    expect(await screen.findByRole('heading', { name: 'Controller' })).toBeInTheDocument();
    expect(window.history.length).toBe(entries);
    expect(screen.getByRole('link', { name: 'Back to Control' })).toBeInTheDocument();
  });

  it('steps back from a page reached inside the app, onto the entry it was reached from and without adding one', async () => {
    openAt('/control');
    fireEvent.click(screen.getByRole('link', { name: 'All about the controller' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Technical details' }));
    await screen.findByRole('heading', { name: 'Technical details' });
    const entries = window.history.length;

    // It says what it does: back, wherever that is.
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Controller' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Control' })).toBeInTheDocument();

    expect(at()).toBe('/control');
    expect(window.history.length).toBe(entries);
    // The entries it left are still ahead: the browser's Forward opens the device again.
    act(() => window.history.forward());
    expect(await screen.findByRole('heading', { name: 'Controller' })).toBeInTheDocument();
  });

  it('starts a page that was opened at its top, and leaves one that is come back to where it is put', async () => {
    openAt('/control');
    scrollTo(540);
    fireEvent.click(screen.getByRole('link', { name: 'All about the controller' }));
    await screen.findByRole('heading', { name: 'Controller' });

    expect(scrolled.to).toHaveBeenCalledWith(0, 0);
    scrolled.to.mockClear();
    scrollTo(200);
    fireEvent.click(screen.getByRole('link', { name: 'Technical details' }));
    await screen.findByRole('heading', { name: 'Technical details' });
    expect(scrolled.to).toHaveBeenCalledWith(0, 0);
    scrolled.to.mockClear();

    scrollTo(120);
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Controller' });
    expect(scrolled.to).not.toHaveBeenCalledWith(0, 0);
  });
});

describe('a device´s own page, come back to', () => {
  const NOW = DateTime.now();
  const device = deviceWith({ ownerId: 'user-1', state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()! } });

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: [device], nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own')], nextCursor: null }) as never;
      if (path.endsWith('/live')) return Promise.resolve({ deviceId: device.id, metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [], nextCursor: null, capabilities: { roles: [] } }) as never;

      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
  });

  it('stands where it was left when the arrow of a page under it leads back', async () => {
    openAt('/control', [
      { path: '/control', element: <Link to={`/devices/${device.id}`}>All about the controller</Link> },
      { path: '/devices/:deviceId/:page?', element: <DevicePage /> },
    ]);
    fireEvent.click(screen.getByRole('link', { name: 'All about the controller' }));
    const details = await screen.findByRole('link', { name: /^Technical details/ });
    scrollTo(310);

    fireEvent.click(details);
    await screen.findByRole('heading', { name: 'Technical details' });
    expect(scrolled.to).toHaveBeenLastCalledWith(0, 0);

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('link', { name: /^Technical details/ });
    await waitFor(() => expect(scrolled.to).toHaveBeenLastCalledWith(0, 310));
  });
});

describe('the addresses around a device that name nothing', () => {
  it('reads /devices as an address of the app with nothing at it - inside the shell, and not as somebody´s handle', () => {
    const matched = matchRoutes(appRouter.routes, '/devices')!;

    expect(matched.some(match => match.route.id === SESSION_ROUTE)).toBe(true);
    expect(matched.at(-1)!.route.path).toBe('devices');
  });

  it('says there that the page does not exist, under a heading and with a way on', () => {
    render(<RouterProvider router={createMemoryRouter(screens, { initialEntries: ['/devices'] })} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the app' })).toHaveAttribute('href', '/');
  });
});
