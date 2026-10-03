import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, MyGrowCard } from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { GrowHeader, GrowPage } from '@/screens/grow/GrowPage';
import { MyGrows, MyGrowsLine } from '@/screens/grow/MyGrows';
import { NoLongerHere } from '@/ui/PageState';
import { ON_THE_DEMO, SIGNED_IN } from './session';

const session = { user: SIGNED_IN };

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  mediaUrl: (id: string, width?: number) => `/media/${id}?width=${width}`,
  useSession: () => session.user,
}));

/**
 * "My grows": every grow of the account on one page - the running ones above
 * the finished ones, each a card saying what its kind of grow is about - and
 * the ways to it and back: the line under Start's cards and the grow page's
 * way back.
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

const jsonOf = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
    wire.calls.push(path);

    if (path === '/home/grows') return jsonOf({ items: wire.grows, nextCursor: null });
    return jsonOf({ status: 404, code: 'not_found', title: 'not_found', detail: `No stub for ${path}`, errors: [] }, 404);
  }),
);

const draw = (node: React.ReactNode, entries: Parameters<typeof MemoryRouter>[0]['initialEntries'] = ['/']) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={entries}>
        <LogProvider>{node}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const shelf = (name: string) => screen.getByRole('region', { name });

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  wire.grows = [AUTUMN, CUTTINGS, LENAS, SPRING, LAST_YEAR];
  wire.calls = [];
  session.user = SIGNED_IN;
});

describe('the page', () => {
  it('puts the running grows above the finished ones, in the order the server gave, each opening its grow', async () => {
    draw(<MyGrows />);

    expect(await screen.findByRole('heading', { level: 1, name: 'My grows' })).toBeInTheDocument();
    const running = within(shelf('Running')).getAllByRole('link');
    const finished = within(shelf('Finished')).getAllByRole('link');

    expect(running.map(link => link.getAttribute('href'))).toEqual(['/grows/autumn', '/grows/cuttings', '/grows/lenas']);
    expect(finished.map(link => link.getAttribute('href'))).toEqual(['/grows/spring', '/grows/last-year']);
    expect(within(shelf('Running')).getByText('3')).toBeInTheDocument();
    // One read for the page, not one per card.
    expect(wire.calls.filter(path => path !== '/me')).toEqual(['/home/grows']);
  });

  it('says of a running grow its day, phase and week, where it stands and what was sown', async () => {
    draw(<MyGrows />);

    const autumn = await screen.findByRole('link', { name: /Autumn run/ });
    expect(autumn).toHaveTextContent('Day 33 · Flower · week 3');
    expect(autumn).toHaveTextContent('Fridge 1');
    expect(autumn).toHaveTextContent('Gelato ×2 · Amnesia Haze');
    expect(autumn.querySelector('img')).toHaveAttribute('src', '/media/still-1?width=720');

    // A grow standing in no place says so rather than leaving the line out, in the words the grow page and Start use.
    expect(screen.getByRole('link', { name: /Cuttings/ })).toHaveTextContent('No fixed place');
  });

  // Whose it is is the tag itself rather than the end of the place's line, where a phone cut it off first;
  // "shared" alone read like a grow shared by link.
  it('marks a grow somebody else runs in a place the grower was let into with whose it is', async () => {
    draw(<MyGrows />);

    const lenas = await screen.findByRole('link', { name: /Lena´s tent run/ });
    expect(within(lenas).getByText('by @lena')).toBeInTheDocument();
    expect(within(lenas).getByText('Lena´s tent')).toBeInTheDocument();
    expect(lenas).not.toHaveTextContent('shared');
    expect(screen.getByRole('link', { name: /Autumn run/ })).not.toHaveTextContent('by @');
  });

  it('says of a finished grow when it ran, the grow day it got to, and what came down where it was weighed', async () => {
    draw(<MyGrows />);

    const spring = await screen.findByRole('link', { name: /Spring run/ });
    // The year once, where both days fall in it.
    expect(spring).toHaveTextContent('1 Feb – 1 Jun 2026');
    // The grow day the grow page calls its last, not a count of calendar days that differs from the dates by one now and then.
    expect(spring).toHaveTextContent('to day 121 · Fridge 1');
    expect(spring).toHaveTextContent('Harvest · dry 386 g · wet 1700 g');
    // A weight breaks as a whole or not at all.
    expect(spring.textContent).toContain('wet\u00a01700\u00a0g');

    const windowsill = screen.getByRole('link', { name: /Windowsill/ });
    expect(windowsill).toHaveTextContent('20 Nov 2025 – 10 Jan 2026');
    expect(windowsill).toHaveTextContent('to day 52 · No fixed place');
    expect(windowsill).not.toHaveTextContent('Harvest');
    // No picture: the quiet frame rather than a broken image.
    expect(windowsill.querySelector('img')).toBeNull();
  });

  it('leads back to Start, or to Ich where its door there opened it', async () => {
    const start = draw(<MyGrows />);
    expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    start.unmount();

    draw(<MyGrows />, [{ pathname: '/grows', state: { from: 'me' } }]);
    expect(await screen.findByRole('link', { name: 'Me' })).toHaveAttribute('href', '/me');
  });

  it('says what an empty half would hold rather than dropping it', async () => {
    wire.grows = [AUTUMN];
    draw(<MyGrows />);

    expect(await within(await screen.findByRole('region', { name: 'Finished' })).findByText(/Nothing finished yet/)).toBeInTheDocument();
  });

  it('says no grow is running where only finished ones are, and offers the next one there', async () => {
    wire.grows = [SPRING];
    draw(<MyGrows />);

    const running = await screen.findByRole('region', { name: 'Running' });
    expect(within(running).getByText('No grow is running right now.')).toBeInTheDocument();
    expect(within(running).getByRole('button', { name: 'New grow' })).toBeInTheDocument();
    expect(within(shelf('Finished')).getAllByRole('link')).toHaveLength(1);
  });

  it('opens on what the page is for where there is no grow at all, with the way to the first one', async () => {
    wire.grows = [];
    draw(<MyGrows />);

    expect(await screen.findByText('No grow yet')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Running' })).not.toBeInTheDocument();
    // One way to start, in the empty card, rather than a second one beside it.
    expect(screen.getAllByRole('button', { name: /New grow/ })).toHaveLength(1);
  });

  it('starts a grow from the last tile among the running ones', async () => {
    draw(<MyGrows />);

    const tile = await within(await screen.findByRole('region', { name: 'Running' })).findByRole('button', { name: 'New grow' });
    fireEvent.click(tile);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('offers no new grow to the demo, which may look and not write', async () => {
    session.user = ON_THE_DEMO;
    draw(<MyGrows />);

    await screen.findByRole('link', { name: /Autumn run/ });
    expect(screen.queryByRole('button', { name: /New grow/ })).not.toBeInTheDocument();
  });

  it('is what stops the page for a grow somebody cannot reach blaming the grow for having ended', async () => {
    // "My grows" is one tap away and opens a finished grow in full, so a page
    // that explained a 404 by the grow having ended would be contradicted by
    // the screen beside it.
    draw(
      <>
        <NoLongerHere what="grow" />
        <MyGrows />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This grow cannot be opened.');
    expect(screen.queryByText(/has ended/)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Spring run/ })).toBeInTheDocument();
  });
});

describe('the line under Start´s cards', () => {
  it('counts the running and the finished grows and leads to the page', async () => {
    draw(<MyGrowsLine />);

    const line = await screen.findByRole('link', { name: /My grows/ });
    expect(line).toHaveAttribute('href', '/grows');
    expect(line).toHaveTextContent('3 running · 2 finished');
  });

  it('leaves out a half that holds nothing, and is not there at all without a grow', async () => {
    wire.grows = [SPRING];
    const one = draw(<MyGrowsLine />);
    expect(await screen.findByRole('link', { name: /My grows/ })).toHaveTextContent(/My grows·?\s*1 finished$/);
    one.unmount();

    wire.grows = [];
    const { container } = draw(<MyGrowsLine />);
    await waitFor(() => expect(wire.calls.filter(path => path === '/home/grows')).toHaveLength(2));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the way back from a grow', () => {
  const grow = {
    id: 'spring',
    ownerId: 'user-1',
    name: 'Spring run',
    type: 'photoperiod',
    phases: [],
    placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: '2026-02-01T10:00:00.000Z', endedAt: null, plantIds: null }],
    visibility: 'private',
    slug: 'spring-run',
    startedAt: '2026-02-01T10:00:00.000Z',
    endedAt: null,
    summary: {
      dayNumber: 33,
      stage: null,
      preset: null,
      phaseDay: null,
      weekNumber: null,
      stageWeek: null,
      isAuto: false,
      groups: [],
      locations: [{ spaceId: 'space-1', plantIds: [] }],
    },
  } as unknown as GrowListItem;
  const spaces = [{ id: 'space-1', name: 'Fridge 1' } as never];
  const NOW = DateTime.fromISO('2026-10-03T12:00:00.000Z');

  it('keeps where it was opened from through the step to its first tab', async () => {
    const router = createMemoryRouter([{ path: '/grows/:growId/:tab?', element: <GrowPage /> }], {
      initialEntries: [{ pathname: '/grows/spring', state: { from: 'grows' } }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/grows/spring/weeks'));
    expect(router.state.location.state).toEqual({ from: 'grows' });
  });

  it('leads to "My grows" when the grow was opened there', () => {
    draw(<GrowHeader grow={grow} plants={[]} spaces={spaces} now={NOW} onShare={null} />, [{ pathname: '/grows/spring', state: { from: 'grows' } }]);

    expect(screen.getByRole('link', { name: 'Back to My grows' })).toHaveAttribute('href', '/grows');
  });

  it('leads to "My grows" from a finished grow, which no cockpit shows any more', () => {
    draw(<GrowHeader grow={{ ...grow, endedAt: '2026-06-01T10:00:00.000Z' }} plants={[]} spaces={spaces} now={NOW} onShare={null} />);

    expect(screen.getByRole('link', { name: 'Back to My grows' })).toHaveAttribute('href', '/grows');
  });

  it('leads to the cockpit it came from otherwise, which with one place is Start', () => {
    draw(<GrowHeader grow={grow} plants={[]} spaces={spaces} now={NOW} onShare={null} />);

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });
});
