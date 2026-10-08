import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rail } from '@/app/shell/Rail';
import { TabBar } from '@/app/shell/TabBar';
import { LogProvider } from '@/log/LogProvider';
import { drawAt, json } from './harness';
import { translate } from './translations';

// What a card offers depends on who is looking, so a test says who that is.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const wire = vi.hoisted(() => ({ diary: false }));

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  if (path === '/home') return json({ spaces: [], followedGrows: [], people: [], layers: { diary: wire.diary } });
  if (path === '/me') return json({ preferences: { layoutSeen: null }, layers: { diary: wire.diary } });
  if (path === '/devices') return json({ items: [{ id: 'device-1' }], nextCursor: null });
  return json({ items: [], nextCursor: null });
});

const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

/**
 * The bar is Start · Verlauf · Steuerung · Gerät for every account, and every
 * caption comes out of the shipped catalogue - a key that is not in there
 * shows up here as its own name. The diary puts the raised Log button in the
 * middle; it opens the sheet over whatever is showing, so it is a button and
 * goes nowhere. Tasks are no tab: they are reached from a grow and the bell.
 */
describe('the navigation', () => {
  beforeAll(() => translate());

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub);
    localStorage.clear();
    wire.diary = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has the four decided destinations in order, and no Log button without a diary', async () => {
    const { container } = draw(<TabBar />);

    expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Control', 'Device']);
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/', '/timeline', '/control', '/devices']);
    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument();
  });

  it('puts Log in the middle as an action rather than a place once the diary is kept', async () => {
    wire.diary = true;
    const { container } = draw(<TabBar />);

    await waitFor(() =>
      expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Log', 'Control', 'Device']),
    );
    expect(screen.getByRole('button', { name: 'Log' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/', '/timeline', '/control', '/devices']);
  });

  it('draws the same tabs down the rail, with the Log key only where the diary is kept', async () => {
    draw(<Rail />);
    await waitFor(() => expect(fetchStub).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /Log/ })).not.toBeInTheDocument();
    for (const name of ['Home', 'Timeline', 'Control', 'Device']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).not.toBeInTheDocument();
  });
});
