import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, HomeAnswer, PlantPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { useLog } from '@/log/log-context';

/**
 * The Log sheet: what one tap writes, what it says it wrote, and what happens
 * when it does not land.
 *
 * Every request is the app's own client, mocked at that one seam, so what is
 * asserted is the body that would go on the wire - the tile's defaults come
 * from the newest line of that kind, and a feed's doses are the scheme's.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const NOW = new Date('2026-09-18T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const home: HomeAnswer = {
  spaces: [
    {
      spaceId: 'space-1',
      name: 'Tent 1',
      kind: 'tent',
      roomId: null,
      deviceIds: ['device-1'],
      values: [],
      setpoints: [],
      trend: null,
      grow: {
        growId: 'grow-1',
        name: 'Spring run',
        type: 'photoperiod',
        dayNumber: 34,
        phaseDay: 11,
        stage: 'flowering',
        preset: 'flower',
        isAuto: false,
        plantCount: 2,
        strains: ['Amnesia', 'Gelato'],
        coverMediaId: null,
        stageGroups: [],
      },
      entries: [],
      latestStill: null,
      dueTasks: [],
      openAlerts: [],
    },
  ],
  followedGrows: [],
  people: [],
};

const grow: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  description: null,
  type: 'photoperiod',
  phases: [],
  placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: daysAgo(34), endedAt: null, plantIds: null }],
  scheme: {
    origin: { type: 'asset', assetId: 'biobizz', version: '2026-01' },
    strength: 1,
    waterEc: 0.3,
    plantType: 'soil',
    flipWeek: 4,
    edited: false,
    grid: [
      { week: 4, stage: 'flowering', amounts: [{ productKey: 'bio_grow', name: 'Bio·Grow', value: 2, unit: 'ml/l' }] },
      {
        week: 5,
        stage: 'flowering',
        amounts: [
          { productKey: 'bio_bloom', name: 'Bio·Bloom', value: 2, unit: 'ml/l' },
          { productKey: 'top_max', name: 'Top·Max', value: 1, unit: 'ml/l' },
          { productKey: 'bio_grow', name: 'Bio·Grow', value: null, unit: 'ml/l' },
        ],
      },
    ],
  },
  measurements: [
    { key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: null, chart: true },
    { key: 'ph', name: 'pH', unit: '', perPlant: false, targetMin: 6.3, targetMax: 6.3, chart: true },
  ],
  visibility: 'private',
  slug: 'spring-run',
  coverMediaId: null,
  filmMediaId: null,
  startedAt: daysAgo(34),
  endedAt: null,
  isDemo: false,
  createdAt: daysAgo(34),
  updatedAt: daysAgo(0),
  summary: {
    dayNumber: 34,
    stage: 'flowering',
    preset: 'flower',
    phaseDay: 11,
    weekNumber: 5,
    isAuto: false,
    groups: [],
    locations: [{ spaceId: 'space-1', plantIds: ['plant-1', 'plant-2'] }],
  },
};

const plants: PlantPage = {
  items: [
    { id: 'plant-1', growId: 'grow-1', strain: 'Amnesia', label: 'Amnesia 1', status: 'active', harvest: null, createdAt: daysAgo(34) },
    { id: 'plant-2', growId: 'grow-1', strain: 'Gelato', label: 'Gelato 1', status: 'active', harvest: null, createdAt: daysAgo(34) },
  ],
  nextCursor: null,
};

/** The newest watering: two litres, three days back - which is what the Water tile offers. */
const lastWater: Entry = {
  id: 'entry-water',
  createdAt: daysAgo(3),
  kind: 'water',
  occurredAt: daysAgo(3),
  source: 'human',
  authorId: 'user-1',
  growId: 'grow-1',
  spaceId: null,
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text: null,
  message: null,
  values: { kind: 'water', litres: 2, readings: [] },
  mediaIds: [],
  undoUntil: null,
};

/** The newest feed: a bigger can than the watering, which is what the feed details open on. */
const lastFeed: Entry = {
  ...lastWater,
  id: 'entry-feed',
  kind: 'feed',
  occurredAt: daysAgo(2),
  values: { kind: 'feed', litres: 4, schemeWeek: 5, doses: [], readings: [] },
};

const written: Entry = { ...lastWater, id: 'entry-new', occurredAt: NOW.toISOString(), undoUntil: new Date(NOW.getTime() + 300_000).toISOString() };

const answers = (path: string) => {
  if (path === '/home') return home;
  if (path === '/grows/grow-1') return grow;
  if (path === '/grows/grow-1/plants') return plants;
  if (path === '/entries') return { items: [lastFeed, lastWater], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

/** The sheet is opened the way the tab bar opens it, and a task ticked off the way a due card ticks it. */
function OpenLog() {
  const { openSheet, complete } = useLog();
  return (
    <>
      <button type="button" onClick={() => openSheet()}>
        open
      </button>
      <button type="button" onClick={() => complete('task-1', 'Watered · Spring run')}>
        done
      </button>
    </>
  );
}

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>
          <OpenLog />
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const openSheet = async () => {
  draw();
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  await screen.findByRole('dialog', { name: 'Log' });
  // The captions arrive with the grow and its newest lines, a moment after the tiles.
  await waitFor(() => expect(screen.getByText(/^2 L · last /)).toBeInTheDocument());
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });

  // The sheet counts the grow's weeks off the clock - which week of the scheme
  // the doses come from is a question about today - so the clock is one of the
  // fixtures. Only `Date`, because waiting for a render still needs real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockResolvedValue(written as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
});

describe('the log sheet', () => {
  it('offers the eight tiles with what was logged last time on them, against the grow, its tent and its plants', async () => {
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    expect(within(sheet).getByRole('button', { name: /^Spring run/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Tent 1' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Amnesia 1' })).toBeInTheDocument();

    const tiles = ['Water', 'Feed', 'Photo', 'Note', 'Measure', 'Training', 'Phase', 'In the tent'];
    for (const tile of tiles) expect(within(sheet).getByRole('button', { name: new RegExp(`^${tile}`) })).toBeInTheDocument();

    // The captions: the last can, the scheme's week, the grow's own measurements, the phase after this one.
    expect(within(sheet).getByText('2 L · last 3 d')).toBeInTheDocument();
    expect(within(sheet).getByText('Bio·Bloom · wk 5')).toBeInTheDocument();
    expect(within(sheet).getByText('Height · pH')).toBeInTheDocument();
    expect(within(sheet).getByText('→ Drying')).toBeInTheDocument();
  });

  it('writes the last can on one tap, says so, and takes it back again', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'water',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: undefined,
      values: { kind: 'water', litres: 2 },
    });

    // The sheet is out of the way before anything is sent, and what was written is on screen.
    expect(screen.queryByRole('dialog', { name: 'Log' })).not.toBeInTheDocument();
    const toast = await screen.findByText('Watered · Spring run · Day 34');
    expect(toast).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/entries/entry-new'));
    await waitFor(() => expect(screen.queryByText('Watered · Spring run · Day 34')).not.toBeInTheDocument());
  });

  it('says when a line did not save and offers it again rather than pretending', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    expect(await screen.findByText('Could not save that line')).toBeInTheDocument();

    vi.mocked(api.post).mockResolvedValue(written as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Watered · Spring run · Day 34')).toBeInTheDocument();
  });

  it('holds a tile for the details, where the doses follow the water and the line is logged as planned', async () => {
    await openSheet();
    // A long press is a hold on a phone and a shift-click on a keyboard.
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }), { shiftKey: true });

    const details = await screen.findByRole('dialog', { name: 'Feed · week 5 of the scheme' });
    expect(within(details).getByText('4 L')).toBeInTheDocument();
    expect(within(details).getByText('8 ml')).toBeInTheDocument();
    expect(within(details).getByText('4 ml')).toBeInTheDocument();
    // A product this week prints no figure for is finished, not dosed at zero.
    expect(within(details).getByText('stops after week 4')).toBeInTheDocument();

    fireEvent.click(within(details).getByRole('button', { name: 'Log as planned' }));
    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'feed',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: undefined,
      text: undefined,
      // The doses are the server's to read off the grid: what goes on the wire is the can.
      values: { kind: 'feed', litres: 4, readings: [] },
    });
  });

  it('dates a line to the day it says, and doses a backdated feed at that day´s week of the scheme', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }), { shiftKey: true });

    const details = await screen.findByRole('dialog', { name: 'Feed · week 5 of the scheme' });
    fireEvent.change(within(details).getByLabelText('When'), { target: { value: '2026-09-11' } });

    // A week back is a week earlier in the grid, and the sheet says so before anything is written.
    const lastWeek = await screen.findByRole('dialog', { name: 'Feed · week 4 of the scheme' });
    expect(within(lastWeek).getByText('8 ml')).toBeInTheDocument();
    expect(within(lastWeek).queryByText('4 ml')).not.toBeInTheDocument();

    fireEvent.click(within(lastWeek).getByRole('button', { name: 'Log as planned' }));
    const [[, body]] = vi.mocked(api.post).mock.calls;
    // The day the person chose, in their own zone, at the hour they are writing it down.
    const dated = new Date((body as { occurredAt: string }).occurredAt);
    expect([dated.getFullYear(), dated.getMonth() + 1, dated.getDate()]).toEqual([2026, 9, 11]);
  });

  it('keeps offering the last can it knows, past a watering that recorded none', async () => {
    const noCan: Entry = { ...lastWater, id: 'entry-ticked', occurredAt: daysAgo(1), values: { kind: 'water', litres: null, readings: [] } };
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/entries' ? { items: [noCan, lastFeed, lastWater], nextCursor: null } : answers(path)),
    );

    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', expect.objectContaining({ values: { kind: 'water', litres: 2 } }));
  });

  it('ticks a due task off once, however often the card is tapped', async () => {
    let answered: (entry: Entry) => void = () => undefined;
    vi.mocked(api.post).mockReturnValue(new Promise<Entry>(resolve => (answered = resolve)) as never);

    draw();
    const done = screen.getByRole('button', { name: 'done' });
    fireEvent.click(done);
    fireEvent.click(done);
    fireEvent.click(done);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/completions', {});

    answered(written);
    await waitFor(() => expect(screen.getByText('Watered · Spring run')).toBeInTheDocument());
  });

  it('writes a line about one plant when a plant is the target', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Gelato 1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'water',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: ['plant-2'],
      values: { kind: 'water', litres: 2 },
    });
  });
});
