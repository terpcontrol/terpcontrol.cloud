import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import { Timeline } from '@/screens/Timeline';
import { drawAt, json, NOT_FOUND } from './harness';
import { translate } from './translations';

// Which of the two sessions is looking, because the tab's empty state is the
// one thing on it that differs between them.
const who = vi.hoisted(() => ({ is: 'you' as 'you' | 'demo' | 'admin' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');
  const of = { you: SIGNED_IN, demo: ON_THE_DEMO, admin: { ...SIGNED_IN, user: { ...SIGNED_IN.user!, isAdmin: true } } };

  return { ...(await importOriginal<object>()), useSession: () => of[who.is] };
});

// A home with no place on it at all unless a test puts some there: the empty
// state is what this tab can draw without a timeline behind it.
const home = vi.hoisted(() => ({ spaces: [] as unknown[] }));

vi.mock('@/api/home', () => ({ useHome: () => ({ isPending: false, data: { spaces: home.spaces }, refetch: () => {} }) }));

/**
 * The Timeline tab when the home draws nothing. The screen itself is covered by
 * timeline.test.tsx; what is asked here is who the empty state is addressed to.
 */
describe('the timeline tab with nothing to draw', () => {
  beforeAll(() => translate());

  beforeEach(() => {
    who.is = 'you';
    home.spaces = [];
  });

  const draw = () => drawAt(<Timeline />);

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

/** Where the page stands, for the tests that follow an address being put right. */
function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{`${pathname}${search}`}</output>;
}

/**
 * A place's tile names its place in the link it opens, so an account with
 * several places lands on the one the tile was on - not on whichever place was
 * chosen last.
 */
describe('the timeline tab opened from a place', () => {
  const asked: string[] = [];
  /** The places the wire knows by their overview; any other is not there. */
  const known = new Set<string>();

  beforeEach(() => {
    who.is = 'you';
    home.spaces = [
      { spaceId: 'space-1', name: 'Tent 1', values: [], deviceIds: ['device-1'], dueTasks: [], openAlerts: [] },
      { spaceId: 'space-2', name: 'Fridge 2', values: [], deviceIds: ['device-2'], dueTasks: [], openAlerts: [] },
    ];
    asked.length = 0;
    known.clear();
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input).replace(/^.*\/v1/, '');
        asked.push(path);
        const overview = /^\/spaces\/([^/]+)\/overview/.exec(path);
        if (overview && known.has(overview[1])) return json({ spaceId: overview[1], name: 'Their tent', deviceIds: [] });
        return json(NOT_FOUND, 404);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const timelineOf = (spaceId: string) => asked.some(path => path.startsWith(`/spaces/${spaceId}/timeline`));
  const draw = (at: string) =>
    drawAt(
      <>
        <Timeline />
        <Address />
      </>,
      { at },
    );

  it('opens on the place the link names, and makes it the chosen one', async () => {
    draw('/timeline?space=space-2&focus=humidity');

    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('space-1')).toBe(false);
    expect(localStorage.getItem('terp.place')).toBe('space-2');
  });

  it('opens on the chosen place where the address names none', async () => {
    localStorage.setItem('terp.place', 'space-2');
    draw('/timeline');

    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('space-1')).toBe(false);
  });

  it('opens a browser that has chosen none on the place Start lists first, and keeps to it', async () => {
    home.spaces = [home.spaces[0], { ...(home.spaces[1] as object), openAlerts: [{ alertId: 'alert-1', severity: 'warning' }] }];
    draw('/timeline');

    // The place that needs a person, not the first the account set up.
    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('space-1')).toBe(false);
    // Kept, so the page does not move to another place once that one asks louder.
    expect(localStorage.getItem('terp.place')).toBe('space-2');
  });

  it('draws a customer’s place for support rather than swapping it for one of the reader’s own', async () => {
    who.is = 'admin';
    known.add('customer-9');
    draw('/timeline?space=customer-9');

    expect(screen.getByText("support view of a customer's place")).toBeInTheDocument();
    await waitFor(() => expect(timelineOf('customer-9')).toBe(true));
    expect(screen.getByTestId('address')).toHaveTextContent('/timeline?space=customer-9');
    // A customer's place is no choice of the reader's.
    expect(localStorage.getItem('terp.place')).not.toBe('customer-9');
  });

  it('tells support that a place is not there, with the way back and no retry', async () => {
    who.is = 'admin';
    draw('/timeline?space=nothing-here');

    expect(await screen.findByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps an ordinary account on its own places whatever the address names, and takes the wrong place out of it', async () => {
    localStorage.setItem('terp.place', 'space-2');
    draw('/timeline?space=customer-9&focus=humidity');

    expect(screen.queryByText("support view of a customer's place")).not.toBeInTheDocument();
    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('customer-9')).toBe(false);
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\/timeline$/));
  });
});
