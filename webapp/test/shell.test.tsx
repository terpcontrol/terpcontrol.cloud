import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rail } from '@/app/shell/Rail';
import { TabBar } from '@/app/shell/TabBar';
import { TopBar } from '@/app/shell/TopBar';
import { LogProvider } from '@/log/LogProvider';
import { deviceWith } from './fixtures';
import { drawAt, json } from './harness';
import { translate } from './translations';

// What a card offers depends on who is looking, so a test says who that is.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const wire = vi.hoisted(() => ({ diary: false, devices: 1 }));

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  if (path === '/home') return json({ spaces: [], followedGrows: [], people: [], layers: { diary: wire.diary } });
  if (path === '/me') return json({ preferences: { layoutSeen: null }, layers: { diary: wire.diary } });
  if (path === '/devices') return json({ items: [deviceWith({ spaceId: null })].slice(0, wire.devices), nextCursor: null });
  return json({ items: [], nextCursor: null });
});

const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

/**
 * The bar is Start · Grow · Eintrag · Verlauf · Steuerung, each there for what
 * the account has, and every caption comes out of the shipped catalogue - a
 * key that is not in there shows up here as its own name. One device and no
 * diary is Start · Verlauf · Steuerung; the diary brings Grow and the green
 * Log button, which opens the sheet over whatever is showing, so it is a
 * button and goes nowhere. Tasks, Meldungen and Ich are no items of the bar.
 */
describe('the navigation', () => {
  beforeAll(() => translate());

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub);
    localStorage.clear();
    wire.diary = false;
    wire.devices = 1;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is Start, Verlauf and Steuerung for a device without a diary, with no Log button', async () => {
    const { container } = draw(<TabBar />);

    expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Control']);
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/', '/timeline', '/control']);
    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument();
  });

  it('puts Grow and Log between Start and Verlauf once the diary is kept, Log as an action rather than a page', async () => {
    wire.diary = true;
    const { container } = draw(<TabBar />);

    await waitFor(() =>
      expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Grow', 'Log', 'Timeline', 'Control']),
    );
    expect(screen.getByRole('button', { name: 'Log' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/', '/grow', '/timeline', '/control']);
  });

  it('draws no bar on the phone for an account that has nothing yet, and keeps the rail with Start, Alerts and Me', async () => {
    wire.devices = 0;
    const { container } = draw(
      <>
        <TabBar />
        <Rail />
      </>,
    );

    await waitFor(() => expect(container.querySelectorAll('nav')).toHaveLength(1));
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Home', 'Alerts', 'Me']);
  });

  it('draws the same pages down the rail, with Alerts and Me at its foot and Log only where the diary is kept', async () => {
    draw(<Rail />);
    await waitFor(() => expect(fetchStub).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Home', 'Timeline', 'Control', 'Alerts', 'Me']);
    expect(screen.queryByRole('link', { name: 'Tasks' })).not.toBeInTheDocument();
  });

  it('gives the rail the green Log button under its pages once the diary is kept', async () => {
    wire.diary = true;
    draw(<Rail />);

    expect(await screen.findByRole('button', { name: 'Log' })).toHaveAttribute('aria-keyshortcuts', 'l');
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Home', 'Grow', 'Timeline', 'Control', 'Alerts', 'Me']);
  });

  it('opens the entry sheet on L, with or without Shift, and never over a sheet that is open', async () => {
    wire.diary = true;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    draw(<Rail />);
    await screen.findByRole('button', { name: 'Log' });

    fireEvent.keyDown(window, { key: 'L', shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Log' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('leaves L alone while another sheet is open', async () => {
    wire.diary = true;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    draw(
      <>
        <Rail />
        <div role="dialog" aria-label="Place" />
      </>,
    );
    await screen.findByRole('button', { name: 'Log' });

    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() => expect(fetchStub).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Log' })).not.toBeInTheDocument();
  });

  it('names the rail´s entry button by its word alone', async () => {
    wire.diary = true;
    draw(<Rail />);

    expect(await screen.findByRole('button', { name: 'Log' })).toHaveTextContent('+Log');
  });
});

/**
 * The install's feedback widget (BugDrop on terpcontrol.cloud) is offered beside the alerts on every page the shell
 * draws, in the top bar on a phone and on the rail beside a wide screen - and nowhere on an install that loads none.
 */
describe('the feedback button', () => {
  beforeAll(() => translate());

  beforeEach(() => vi.stubGlobal('fetch', fetchStub));

  afterEach(() => {
    delete window.BugDrop;
    vi.unstubAllGlobals();
  });

  it('is not there where the install loads no feedback widget', async () => {
    draw(
      <>
        <TopBar />
        <Rail />
      </>,
    );
    await waitFor(() => expect(fetchStub).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /feedback/i })).not.toBeInTheDocument();
  });

  it('appears once the widget is ready, says a report is public, and opens the form', async () => {
    const open = vi.fn();
    draw(<TopBar />);

    // The widget is a plain script that may finish after the page has drawn; it says so on `window`.
    act(() => {
      window.BugDrop = { open };
      window.dispatchEvent(new Event('bugdrop:ready'));
    });
    const button = await screen.findByRole('button', { name: 'Send feedback - it becomes a public issue on GitHub' });

    fireEvent.click(button);
    expect(open).toHaveBeenCalledOnce();
  });

  it('stands on the rail above the alerts', async () => {
    window.BugDrop = { open: vi.fn() };
    draw(<Rail />);

    const button = await screen.findByRole('button', { name: 'Feedback' });
    expect(button.compareDocumentPosition(screen.getByRole('link', { name: 'Alerts' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
