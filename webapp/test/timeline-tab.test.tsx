import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '@/screens/Timeline';
import { drawAt, json } from './harness';
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

/**
 * A place's tile names its place in the link it opens, so an account with
 * several places lands on the one the tile was on - not on whichever place was
 * chosen last.
 */
describe('the timeline tab opened from a place', () => {
  const asked: string[] = [];

  beforeEach(() => {
    who.is = 'you';
    home.spaces = [
      { spaceId: 'space-1', name: 'Tent 1', values: [], deviceIds: ['device-1'] },
      { spaceId: 'space-2', name: 'Fridge 2', values: [], deviceIds: ['device-2'] },
    ];
    asked.length = 0;
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        asked.push(String(input).replace(/^.*\/v1/, ''));
        return json({ code: 'not_found' }, 404);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const timelineOf = (spaceId: string) => asked.some(path => path.startsWith(`/spaces/${spaceId}/timeline`));

  it('opens on the place the link names, and makes it the chosen one', async () => {
    drawAt(<Timeline />, { at: '/timeline?space=space-2&focus=humidity' });

    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('space-1')).toBe(false);
    expect(localStorage.getItem('terp.place')).toBe('space-2');
  });

  it('opens on the chosen place where the address names none, and on the first where none was chosen', async () => {
    localStorage.setItem('terp.place', 'space-2');
    const { unmount } = drawAt(<Timeline />, { at: '/timeline' });
    await waitFor(() => expect(timelineOf('space-2')).toBe(true));
    expect(timelineOf('space-1')).toBe(false);
    unmount();

    localStorage.clear();
    drawAt(<Timeline />, { at: '/timeline' });
    await waitFor(() => expect(timelineOf('space-1')).toBe(true));
  });

  it('draws a customer’s place for support rather than swapping it for one of the reader’s own', async () => {
    who.is = 'admin';
    drawAt(<Timeline />, { at: '/timeline?space=customer-9' });

    expect(screen.getByText("support view of a customer's place")).toBeInTheDocument();
    await waitFor(() => expect(timelineOf('customer-9')).toBe(true));
    expect(localStorage.getItem('terp.place')).toBeNull();
  });

  it('keeps an ordinary account on its own places whatever the address names', async () => {
    drawAt(<Timeline />, { at: '/timeline?space=customer-9' });

    expect(screen.queryByText("support view of a customer's place")).not.toBeInTheDocument();
    await waitFor(() => expect(timelineOf('space-1')).toBe(true));
    expect(timelineOf('customer-9')).toBe(false);
  });
});
