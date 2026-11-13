import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyGrowCard } from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { GrowPage } from '@/screens/grow/GrowPage';
import { Grows } from '@/screens/grow/Grows';
import { NoLongerHere } from '@/ui/PageState';
import { drawAt, json, testClient } from './harness';
import { ON_THE_DEMO, SIGNED_IN } from './session';
import { translate } from './translations';

const session = { user: SIGNED_IN };

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  mediaUrl: (id: string, width?: number) => `/media/${id}?width=${width}`,
  useSession: () => session.user,
}));

/**
 * "Grows": every grow the account sees on one page - the running ones as
 * cards, the finished ones as rows that lead to their report, then the doors
 * to what belongs to growing - and the way back from it.
 */

const card = (growId: string, over: Partial<MyGrowCard> = {}): MyGrowCard => ({
  growId,
  name: growId,
  type: 'photoperiod',
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: null,
  dayNumber: 33,
  stage: 'flowering',
  stageWeek: 3,
  places: [{ spaceId: 'space-1', name: 'Fridge 1' }],
  owner: null,
  plantCount: 4,
  strains: [
    { strain: 'Gelato', count: 2 },
    { strain: 'Amnesia Haze', count: 1 },
  ],
  coverMediaId: null,
  harvest: null,
  ...over,
});

const AUTUMN = card('autumn', { name: 'Autumn run', coverMediaId: 'still-1' });
const CUTTINGS = card('cuttings', {
  name: 'Cuttings',
  dayNumber: 6,
  stage: 'vegetative',
  stageWeek: 1,
  places: [{ spaceId: null, name: null }],
  strains: [{ strain: 'Gelato', count: 3 }],
});
const LENAS = card('lenas', {
  name: 'Lena´s tent run',
  owner: { id: 'user-2', handle: 'lena' },
  places: [{ spaceId: 'space-2', name: 'Lena´s tent' }],
});
const SPRING = card('spring', {
  name: 'Spring run',
  startedAt: '2026-02-01T10:00:00.000Z',
  endedAt: '2026-06-01T10:00:00.000Z',
  dayNumber: 121,
  stage: 'curing',
  harvest: { harvestedAt: '2026-05-20T10:00:00.000Z', wetWeightG: 1700, dryWeightG: 386 },
  coverMediaId: 'photo-1',
});
const LAST_YEAR = card('last-year', {
  name: 'Windowsill',
  startedAt: '2025-11-20T10:00:00.000Z',
  endedAt: '2026-01-10T10:00:00.000Z',
  dayNumber: 52,
  places: [{ spaceId: null, name: null }],
  strains: [],
  plantCount: 0,
  // Harvested without weighing: nothing the dates above do not already say.
  harvest: { harvestedAt: '2026-01-10T10:00:00.000Z', wetWeightG: null, dryWeightG: null },
});

const wire = { grows: [] as MyGrowCard[], calls: [] as string[] };

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
    wire.calls.push(path);

    if (path === '/home/grows') return json({ items: wire.grows, nextCursor: null });
    if (path === '/grows/spring') return json({ status: 404, code: 'not_found', title: 'not_found', detail: '', errors: [] }, 404);
    if (path === '/share-links' || path === '/follows' || path === '/schemes' || path === '/grows') return json({ items: [], nextCursor: null });
    return json({ status: 404, code: 'not_found', title: 'not_found', detail: `No stub for ${path}`, errors: [] }, 404);
  }),
);

const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

const shelf = (name: string) => screen.getByRole('region', { name });

beforeAll(() => translate());

beforeEach(() => {
  wire.grows = [AUTUMN, CUTTINGS, LENAS, SPRING, LAST_YEAR];
  wire.calls = [];
  session.user = SIGNED_IN;
});

describe('the page', () => {
  it('puts the running grows above the finished ones, in the order the server gave: a running one opens its grow, a finished one its report', async () => {
    draw(<Grows />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Grows' })).toBeInTheDocument();
    const running = within(shelf('Running')).getAllByRole('link');
    const finished = within(shelf('Finished')).getAllByRole('link');

    expect(running.map(link => link.getAttribute('href'))).toEqual(['/grows/autumn', '/grows/cuttings', '/grows/lenas']);
    expect(finished.map(link => link.getAttribute('href'))).toEqual(['/grows/spring/report', '/grows/last-year/report']);
    // One read for the grows, not one per card.
    expect(wire.calls.filter(path => path === '/home/grows')).toHaveLength(1);
  });

  it('says of a running grow its day, its phase with the week, and where it stands, beside its picture', async () => {
    draw(<Grows />);

    const autumn = await screen.findByRole('link', { name: /Autumn run/ });
    expect(autumn).toHaveTextContent('Day 33 · Flower, week 3 · Fridge 1');
    expect(autumn.querySelector('img')).toHaveAttribute('src', '/media/still-1?width=240');

    // A grow standing in no place says so rather than leaving the line out, in the words the grow page and Start use.
    const cuttings = screen.getByRole('link', { name: /Cuttings/ });
    expect(cuttings).toHaveTextContent('No fixed place');
    // No picture: its words take the room rather than a frame with nothing in it.
    expect(cuttings.querySelector('img')).toBeNull();
  });

  it('says whose a grow is that somebody else runs in a place the grower was let into', async () => {
    draw(<Grows />);

    expect(await screen.findByRole('link', { name: /Lena´s tent run/ })).toHaveTextContent('Lena´s tent · by @lena');
    expect(screen.getByRole('link', { name: /Autumn run/ })).not.toHaveTextContent('by @');
  });

  it('says of a finished grow how long it ran and the month it came down, or ended where nothing was harvested', async () => {
    // Which year "this year" is, is the clock's to say.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    wire.grows = [SPRING, { ...LAST_YEAR, endedAt: '2025-12-10T10:00:00.000Z', harvest: null }];
    draw(<Grows />);

    expect(await screen.findByRole('link', { name: /Spring run/ })).toHaveTextContent('121 days · harvested in June · Report');
    // Another year than this one is named.
    expect(screen.getByRole('link', { name: /Windowsill/ })).toHaveTextContent('52 days · ended in December 2025 · Report');
    vi.useRealTimers();
  });

  it('leads up to Grow where it was opened by its address', async () => {
    draw(<Grows />);
    expect(await screen.findByRole('link', { name: 'Back to the grow' })).toHaveAttribute('href', '/grow');
  });

  it('leaves a half out that holds nothing, and says so where there is no grow at all', async () => {
    wire.grows = [AUTUMN];
    const one = draw(<Grows />);
    expect(await screen.findByRole('region', { name: 'Running' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Finished' })).not.toBeInTheDocument();
    one.unmount();

    wire.grows = [];
    draw(<Grows />);
    expect(await screen.findByText('No grow yet')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Running' })).not.toBeInTheDocument();
  });

  it('starts a grow from the button beside its title', async () => {
    draw(<Grows />);

    fireEvent.click(await screen.findByRole('button', { name: '+ New grow' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('has the doors to what belongs to growing at its foot', async () => {
    draw(<Grows />);

    const beside = await screen.findByRole('region', { name: 'More' });
    expect(
      within(beside)
        .getAllByRole('link')
        .map(link => link.getAttribute('href')),
    ).toEqual(['/grows/schemes', '/grows/share-links', '/grows/following']);
  });

  it('offers the demo, which may look and not write, neither a new grow nor doors to an account it has not got', async () => {
    session.user = ON_THE_DEMO;
    draw(<Grows />);

    await screen.findByRole('link', { name: /Autumn run/ });
    expect(screen.queryByRole('button', { name: /New grow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'More' })).not.toBeInTheDocument();
  });

  it('is what stops the page for a grow somebody cannot reach blaming the grow for having ended', async () => {
    // Every grow is one tap away and a finished one opens in full, so a page
    // that explained a 404 by the grow having ended would be contradicted by
    // the screen beside it.
    draw(
      <>
        <NoLongerHere what="grow" />
        <Grows />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This grow cannot be opened.');
    expect(screen.queryByText(/has ended/)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Spring run/ })).toBeInTheDocument();
  });
});

describe('the address of a grow opened by its id', () => {
  const drawRoute = (pathname: string) => {
    const router = createMemoryRouter([{ path: '/grows/:growId/:tab?', element: <GrowPage /> }], {
      initialEntries: [pathname],
    });
    render(
      <QueryClientProvider client={testClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  };

  it('is the diary itself, with no step to a tab of its own', async () => {
    const router = drawRoute('/grows/spring');

    await waitFor(() => expect(wire.calls).toContain('/grows/spring'));
    expect(router.state.location.pathname).toBe('/grows/spring');
  });

  it('leads a tab the grow has not got to its diary', async () => {
    const router = drawRoute('/grows/spring/weeks');

    await waitFor(() => expect(router.state.location.pathname).toBe('/grows/spring'));
  });
});
