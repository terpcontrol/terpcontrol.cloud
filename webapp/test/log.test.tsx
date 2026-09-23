import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, Entry, GrowListItem, HomeAnswer, PlantPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { useLog } from '@/log/log-context';
import { spaceWhere, THE_HOST, YOU } from './session';

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

// A phase is the one tile on this sheet that is not a diary line, so the sheet
// asks who is looking and what they may do where the grow stands.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

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
        stageWeek: 2,
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
    stageWeek: 2,
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

/** What the reader may do in Tent 1: a phase is the one tile that is not a diary line. */
const may = { youMay: 'own' as AccessNeed };

/** What stands in Tent 1: one named controller and one nobody has named, which is what the visit panel has to print. */
const standing = [
  { id: 'device-1', type: 'controller', name: 'Big tent controller', spaceId: 'space-1' },
  { id: 'device-2', type: 'plug', name: null, spaceId: 'space-1' },
  { id: 'device-3', type: 'fan', name: 'Somewhere else', spaceId: 'space-2' },
] as unknown as Device[];

/** A second place, with nothing growing in it: the one a "+ Grow" chip points the Phase tile at. */
const emptyPlace = { ...home.spaces[0], spaceId: 'space-2', name: 'Place 2', kind: 'other' as const, deviceIds: [], grow: null };

const answers = (path: string) => {
  if (path === '/home') return home;
  if (path === '/devices') return { items: standing, nextCursor: null };
  if (path === '/grows') return { items: [grow], nextCursor: null };
  if (path === '/cameras') return { items: [], nextCursor: null };
  if (path === '/spaces')
    return { items: [spaceWhere(may.youMay), spaceWhere('own', { id: 'space-2', name: 'Place 2', kind: 'other' })], nextCursor: null };
  // The grow belongs to whoever the tent it stands in does, so one reader's two
  // standings cannot contradict each other.
  if (path === '/grows/grow-1') return { ...grow, ownerId: may.youMay === 'own' ? YOU : THE_HOST };
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
      {/* What a "+ Grow" chip on a place with nothing growing links to: /log?kind=phase&space=<id>. */}
      <button type="button" onClick={() => openSheet({ kind: 'phase', spaceId: 'space-2' })}>
        open phase there
      </button>
      {/* What a bookmark or a notification written months ago carries: a grow
          that has since been harvested, and a tent this account was let out of. */}
      <button type="button" onClick={() => openSheet({ kind: 'note', growId: 'grow-harvested' })}>
        open the finished grow
      </button>
      <button type="button" onClick={() => openSheet({ spaceId: 'space-gone' })}>
        open the place that is gone
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
  may.youMay = 'own';
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

    const tiles = ['Water', 'Feed', 'Photo', 'Note', 'Measure', 'Training', 'Phase', 'Step in'];
    for (const tile of tiles) expect(within(sheet).getByRole('button', { name: new RegExp(`^${tile}`) })).toBeInTheDocument();

    // The captions: the last can, the scheme's week, the grow's own measurements, the phase after this one.
    expect(within(sheet).getByText('2 L · last 3 d')).toBeInTheDocument();
    expect(within(sheet).getByText('Bio·Bloom · wk 5')).toBeInTheDocument();
    expect(within(sheet).getByText('Height · pH')).toBeInTheDocument();
    expect(within(sheet).getByText('→ Drying')).toBeInTheDocument();
  });

  /**
   * Seven of the eight tiles write a diary line, which is what somebody is let
   * into a tent to do. A phase is not one: it moves the grow to another stage
   * and puts the tent's climate on it, which the Control tab already refuses a
   * member - so the tile is gone rather than there and refused on save.
   */
  it('keeps the seven that write a line for a member, and drops the phase', async () => {
    may.youMay = 'log';
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    for (const tile of ['Water', 'Feed', 'Photo', 'Note', 'Measure', 'Training', 'Step in'])
      expect(within(sheet).getByRole('button', { name: new RegExp(`^${tile}`) })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /^Phase/ })).not.toBeInTheDocument();
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

  it('does not offer to measure a tent with nothing growing in it', async () => {
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });
    expect(within(sheet).getByRole('button', { name: /^Measure/ })).toBeInTheDocument();

    // A reading is written against the grow's own measurements, and a tent by itself has none.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    expect(within(sheet).queryByRole('button', { name: /^Measure/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Water/ })).toBeInTheDocument();
  });

  /**
   * Stepping in is the one tile whose line is the smaller half of what it does:
   * the server puts every device standing in the place into maintenance mode for
   * a quarter of an hour, and deleting the line afterwards leaves them parked. So
   * it asks first, names what it reaches by the names those rows carry, and the
   * toast does not offer an Undo that would only be half of one.
   */
  it('asks before it steps in, names every device it will quieten, and offers no Undo for the quiet', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Step in/ }));

    const asked = await screen.findByRole('dialog', { name: 'Step in' });
    expect(api.post).not.toHaveBeenCalled();
    expect(await within(asked).findByText(/all 2 devices standing in Tent 1 into maintenance mode for 15 minutes/)).toBeInTheDocument();
    // By the name each device's own row carries, and only the ones standing here.
    expect(within(asked).getByText('Big tent controller')).toBeInTheDocument();
    expect(within(asked).getByText('Plug · VICE-2')).toBeInTheDocument();
    expect(within(asked).queryByText('Somewhere else')).not.toBeInTheDocument();
    expect(within(asked).getByText(/The 15 minutes of quiet cannot/)).toBeInTheDocument();
    // The day is not asked for: the quiet starts when this is saved, so the line is now.
    expect(within(asked).queryByLabelText('When')).not.toBeInTheDocument();

    fireEvent.click(within(asked).getByRole('button', { name: 'Step in · quieten 2 devices' }));

    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'visit',
      growId: undefined,
      spaceId: 'space-1',
      plantIds: undefined,
      text: undefined,
      values: { kind: 'visit' },
    });

    expect(await screen.findByText('Stepped in · Tent 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says so where nothing stands to be quietened, rather than promising an effect it will not have', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/devices' ? { items: [], nextCursor: null } : answers(path)));

    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Step in/ }));

    const asked = await screen.findByRole('dialog', { name: 'Step in' });
    expect(await within(asked).findByText('Nothing stands in Tent 1, so this is a line in the diary and nothing else.')).toBeInTheDocument();
    expect(within(asked).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  /**
   * The Phase tile is where a place with nothing growing in it sends somebody who
   * asked for a grow: the "+ Grow" chip on the space overview and on the charts
   * links straight at it. A sheet that only says a phase needs a grow leaves them
   * where they started, so it offers the grow.
   */
  it('offers to start a grow where a phase was asked for in a place that has none', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/home' ? { ...home, spaces: [...home.spaces, emptyPlace] } : answers(path)),
    );
    // The feeding schemes ship as assets rather than as a resource, so the sheet fetches them.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ schemes: [] }) })),
    );

    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open phase there' }));

    const phase = await screen.findByRole('dialog', { name: 'Phase' });
    expect(within(phase).getByText('A phase belongs to a grow, and this line is about a place.')).toBeInTheDocument();

    fireEvent.click(await within(phase).findByRole('button', { name: 'Start a grow in Place 2' }));

    // The new-grow sheet takes this one's place, already pointed at the place asked about.
    expect(await screen.findByRole('button', { name: /^Place 2/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog', { name: 'New grow' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Phase' })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * The chips are the home's cards, and the home draws what stands in a place
   * today: a grow that has been harvested is on none of them, and neither is a
   * tent this account was let out of or an id that was never anything. The
   * sheet used to fall through to the first card there is - a live Save button
   * over a running grow, with nothing on screen saying the address had been
   * dropped - so a line meant for last summer landed in this summer's diary.
   */
  it('says a link named a grow that is not here, and points at nothing until a chip is pressed', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open the finished grow' }));

    const sheet = await screen.findByRole('dialog', { name: 'Log' });
    const chip = await within(sheet).findByRole('button', { name: /^Spring run/ });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('The grow or place this link names is not on your home');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('button', { name: /^Note/ })).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument();

    // A chip pressed is a subject somebody chose, and the tile the link asked
    // for opens on it - which is the whole of what the link was good for.
    fireEvent.click(chip);
    expect(await screen.findByRole('dialog', { name: 'Note' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the same of a place that is not here rather than standing in another one', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open the place that is gone' }));

    const sheet = await screen.findByRole('dialog', { name: 'Log' });
    expect(await within(sheet).findByRole('button', { name: /^Spring run/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('alert')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Water/ })).toBeDisabled();
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
