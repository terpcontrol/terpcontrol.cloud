import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, Entry, GrowListItem, HomeAnswer, PlantPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { useLog } from '@/log/log-context';
import { drawAt, reading } from './harness';
import { spaceWhere, THE_HOST, YOU } from './session';
import { translate } from './translations';

/**
 * The Log sheet: what a tile opens and Save writes, what it says it wrote, and what happens
 * when it does not land.
 *
 * Every request is the app's own client, mocked at that one seam, so what is
 * asserted is the body that would go on the wire - the tile's defaults come
 * from the newest line of that kind, and a feed's doses are the scheme's.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
      climates: [],
      kind: 'tent',
      roomId: null,
      deviceIds: ['device-1'],
      // A reading a minute old: the tent is live, which is what maintenance is offered on.
      values: [{ metric: 'temperature', value: 25, measuredAt: new Date(NOW.getTime() - 60_000).toISOString(), state: 'live' }],
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
        stagesReached: ['vegetative', 'flowering'],
        preset: 'flower',
        isAuto: false,
        plantCount: 2,
        strains: ['Amnesia', 'Gelato'],
        coverMediaId: null,
        stageGroups: [],
      },
      entries: [],
      events: [],
      latestStill: null,
      openAlerts: [],
    },
  ],
  followedGrows: [],
  people: [],
  layers: { diary: true },
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
    zone: 'UTC',
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
  { id: 'device-1', type: 'controller', name: 'Big tent controller', spaceId: 'space-1', state: { hardware: {} } },
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

/** What the probe hands the toast: the way an answer is taken back, and what a tick changed beyond the diary. */
const told = { undo: vi.fn<() => Promise<unknown>>(), changed: vi.fn() };

/** The sheet is opened the way the tab bar opens it, and a task ticked off the way a due card ticks it. */
function OpenLog() {
  const { openSheet, openDetails, complete, tell } = useLog();
  return (
    <>
      {/* What a line of the diary opens when somebody who may correct it taps it. */}
      <button
        type="button"
        onClick={() =>
          openDetails(
            'water',
            { key: 'grow:grow-1', label: 'Spring run', growId: 'grow-1', spaceId: null, plantIds: [], dayNumber: 34, standsIn: 'space-1' },
            lastWater,
          )
        }
      >
        correct
      </button>
      {/* What an offer declined on Start says once its card is gone, and what a plan step confirmed there reads again. */}
      <button type="button" onClick={() => tell({ label: 'The diary stays off.', undo: told.undo, undone: 'The question is back on Home' })}>
        tell
      </button>
      <button type="button" onClick={() => complete('step-1', 'Step confirmed · Late flower', { undoable: false, changed: told.changed })}>
        confirm
      </button>
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

/** The head of a JPEG whose EXIF says when it was taken, which is all the photo sheet reads of it. */
const jpegTaken = (stamp: string): Uint8Array<ArrayBuffer> => {
  const tiff = new Uint8Array(64);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, 8, true);
  // IFD0: one entry, the pointer to the Exif directory at 26.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  // The Exif directory: DateTimeOriginal, 20 ASCII bytes at 44.
  view.setUint16(26, 1, true);
  view.setUint16(28, 0x9003, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, 20, true);
  view.setUint32(36, 44, true);
  tiff.set(
    [...stamp].map(char => char.charCodeAt(0)),
    44,
  );
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const length = 2 + exif.length + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, ...tiff]);
};

const draw = () =>
  drawAt(
    <LogProvider>
      <OpenLog />
    </LogProvider>,
  );

const openSheet = async () => {
  draw();
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  await screen.findByRole('dialog', { name: 'Log' });
  // A tile opens once the grow and its newest lines are here, a moment after it is drawn.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Water' })).toBeEnabled());
};

beforeAll(async () => {
  await translate();

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
  vi.mocked(api.post).mockClear();
  vi.mocked(api.delete).mockClear();
  told.undo.mockReset();
  told.changed.mockReset();
});

describe('the log sheet', () => {
  it('offers the seven tiles against the grow and its plants, and asks when it was', async () => {
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    // The grow, then its plants. One place is nothing to choose between, so it is no chip.
    expect(within(sheet).getByRole('button', { name: 'Spring run' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).queryByRole('button', { name: 'Tent 1' })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Amnesia 1' })).toBeInTheDocument();

    for (const tile of ['Water', 'Feed', 'Photo', 'Note', 'Measure', 'Training', 'Phase']) {
      expect(within(sheet).getByRole('button', { name: tile })).toBeInTheDocument();
    }
    // Maintenance is started from Start and from a device, and is no kind of line.
    expect(within(sheet).queryByRole('button', { name: /Maintenance/ })).not.toBeInTheDocument();
    // When it happened is asked at the sheet's foot; a line nobody dated is now.
    expect(within(sheet).getByText('When was this?')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Change when: today · \d\d:\d\d$/ })).toHaveTextContent('Change');
  });

  it('dates a line to the moment said on the sheet, before its kind is chosen', async () => {
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });
    fireEvent.click(within(sheet).getByRole('button', { name: /^Change when/ }));
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-09-11' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Water' }));

    // The view opens dated to that moment, where it can still be changed, and writes the line to it.
    const details = await screen.findByRole('dialog', { name: 'Water' });
    expect(within(details).getByRole('button', { name: /^Change when: 11 Sep \d\d:\d\d$/ })).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: /^Save/ }));
    const [[, body]] = vi.mocked(api.post).mock.calls;
    const dated = new Date((body as { occurredAt: string }).occurredAt);
    expect([dated.getFullYear(), dated.getMonth() + 1, dated.getDate()]).toEqual([2026, 9, 11]);
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  /**
   * Six of the seven tiles write a diary line, which is what somebody is let
   * into a tent to do. A phase is not one: it moves the grow to another stage
   * and puts the tent's climate on it, which Steuerung already refuses a
   * member - so the tile is gone rather than there and refused on save.
   */
  it('keeps the six that write a line for a member, and drops the phase', async () => {
    may.youMay = 'log';
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    for (const tile of ['Water', 'Feed', 'Photo', 'Note', 'Measure', 'Training']) {
      expect(within(sheet).getByRole('button', { name: tile })).toBeInTheDocument();
    }
    expect(within(sheet).queryByRole('button', { name: 'Phase' })).not.toBeInTheDocument();
  });

  it('opens a tile on a tap with the last can and the moment in its corner, saves it, says so, and takes it back again', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    // Nothing is written off the tile itself: its view opens, filled in with what was done last time.
    const details = await screen.findByRole('dialog', { name: 'Water' });
    expect(api.post).not.toHaveBeenCalled();
    // The last can stands in a field that can be typed over, and says when it was poured.
    expect(within(details).getByRole('textbox', { name: 'Water in litres' })).toHaveValue('2');
    expect(within(details).getByText(reading(/^Last time .* · 2 L$/))).toBeInTheDocument();
    // When it happened stands in the corner from the start, and a line nobody dated is now.
    expect(within(details).getByRole('button', { name: /^Change when: today · \d\d:\d\d$/ })).toBeInTheDocument();

    fireEvent.click(within(details).getByRole('button', { name: 'Save · Day 34' }));
    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'water',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: undefined,
      // Dated when it was written, so a line that only gets through later is still of that moment.
      occurredAt: expect.any(String),
      text: undefined,
      values: { kind: 'water', litres: 2, readings: [] },
    });

    // The sheet is out of the way before anything is sent, and what was written is on screen.
    expect(screen.queryByRole('dialog', { name: 'Log' })).not.toBeInTheDocument();
    const toast = await screen.findByText(reading('Watered · Spring run · Day 34'));
    expect(toast).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/entries/entry-new'));
    // The toast answers in its place, and offers nothing more.
    expect(await screen.findByText(reading('Undone · no longer in the diary'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo|Details/ })).not.toBeInTheDocument();
  });

  it('takes a line back that is still on its way the moment it has landed, and says so', async () => {
    let land = (_: unknown) => {};
    vi.mocked(api.post).mockReturnValueOnce(new Promise(resolve => (land = resolve)) as never);
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Water' })).getByRole('button', { name: /^Save/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(screen.getByText('taking it back')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    land(written);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/entries/entry-new'));
    expect(await screen.findByText(reading('Undone · no longer in the diary'))).toBeInTheDocument();
  });

  it('says when a line did not save and offers it again rather than pretending', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Water' })).getByRole('button', { name: /^Save/ }));

    expect(await screen.findByText('Could not save that entry')).toBeInTheDocument();

    vi.mocked(api.post).mockResolvedValue(written as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(reading('Watered · Spring run · Day 34'))).toBeInTheDocument();
  });

  it('opens a feed on a tap, where the doses follow the water and the line is logged as planned', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }));

    // The title is the kind of line; which week of which grid the doses are read from stands with what the line is about.
    const details = await screen.findByRole('dialog', { name: 'Feed' });
    expect(within(details).getByText(reading(/· Scheme week 5$/))).toBeInTheDocument();
    expect(within(details).getByRole('textbox', { name: 'Water in litres' })).toHaveValue('4');
    expect(within(details).getByText('8 ml')).toBeInTheDocument();
    expect(within(details).getByText('4 ml')).toBeInTheDocument();
    // A product this week prints no figure for is finished, not dosed at zero.
    expect(within(details).getByText('stopped after scheme week 4')).toBeInTheDocument();

    fireEvent.click(within(details).getByRole('button', { name: 'Log as planned' }));
    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'feed',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: undefined,
      // Dated when it was written, so a line that only gets through later is still of that moment.
      occurredAt: expect.any(String),
      text: undefined,
      // The doses are the server's to read off the grid: what goes on the wire is the can.
      values: { kind: 'feed', litres: 4, readings: [] },
    });
    // Its toast offers the details once the line is saved.
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('dates a line to the day it says, and doses a backdated feed at that day´s week of the scheme', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }));

    const details = await screen.findByRole('dialog', { name: 'Feed' });
    // The moment in the corner opens a pop-up with the day and the time; nothing after now is taken.
    fireEvent.click(within(details).getByRole('button', { name: /^Change when/ }));
    const day = within(details).getByLabelText('Date');
    expect(day).toHaveAttribute('max');
    fireEvent.change(day, { target: { value: '2026-09-11' } });
    fireEvent.click(within(details).getByRole('button', { name: 'Apply' }));
    expect(within(details).getByRole('button', { name: /^Change when: 11 Sep \d\d:\d\d$/ })).toBeInTheDocument();

    // A week back is a week earlier in the grid, and the sheet says so before anything is written.
    const lastWeek = screen.getByRole('dialog', { name: 'Feed' });
    expect(await within(lastWeek).findByText(reading(/· Scheme week 4$/))).toBeInTheDocument();
    expect(within(lastWeek).getByText('8 ml')).toBeInTheDocument();
    expect(within(lastWeek).queryByText('4 ml')).not.toBeInTheDocument();

    fireEvent.click(within(lastWeek).getByRole('button', { name: 'Log as planned' }));
    const [[, body]] = vi.mocked(api.post).mock.calls;
    // The day the person chose, in their own zone, at the hour they are writing it down.
    const dated = new Date((body as { occurredAt: string }).occurredAt);
    expect([dated.getFullYear(), dated.getMonth() + 1, dated.getDate()]).toEqual([2026, 9, 11]);
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('takes no moment after now, and says why rather than quietly moving it', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));

    const details = await screen.findByRole('dialog', { name: 'Note' });
    fireEvent.click(within(details).getByRole('button', { name: /^Change when/ }));
    fireEvent.change(within(details).getByLabelText('Time'), { target: { value: '23:59' } });

    expect(within(details).getByRole('alert')).toHaveTextContent('That is in the future');
    expect(within(details).getByRole('button', { name: 'Apply' })).toBeDisabled();

    // Escape puts the pop-up away and leaves the sheet open.
    fireEvent.keyDown(within(details).getByLabelText('Time'), { key: 'Escape' });
    expect(within(details).queryByLabelText('Time')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument();
  });

  it('starts a phase at the moment chosen for it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ schemes: [] }) })),
    );
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Phase/ }));

    const phase = await screen.findByRole('dialog', { name: 'Phase' });
    fireEvent.click(within(phase).getByRole('button', { name: /^Change when/ }));
    fireEvent.change(within(phase).getByLabelText('Date'), { target: { value: '2026-09-10' } });
    fireEvent.click(within(phase).getByRole('button', { name: 'Apply' }));

    fireEvent.click(within(phase).getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grows/grow-1/phases', expect.objectContaining({ stage: 'drying' })));
    const [, body] = vi.mocked(api.post).mock.calls.find(([path]) => path === '/grows/grow-1/phases')!;
    expect((body as { startedAt: string }).startedAt).toMatch(/^2026-09-(09|10|11)T/);
  });

  it('keeps offering the last can it knows, past a watering that recorded none', async () => {
    const noCan: Entry = { ...lastWater, id: 'entry-ticked', occurredAt: daysAgo(1), values: { kind: 'water', litres: null, readings: [] } };
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/entries' ? { items: [noCan, lastFeed, lastWater], nextCursor: null } : answers(path)),
    );

    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Water' })).getByRole('button', { name: /^Save/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', expect.objectContaining({ values: { kind: 'water', litres: 2, readings: [] } }));
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText(reading('Watered · Spring run'))).toBeInTheDocument());
  });

  it('reads again what a tick changed beyond the diary, once it has landed', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    expect(await screen.findByText(reading('Step confirmed · Late flower'))).toBeInTheDocument();
    await waitFor(() => expect(told.changed).toHaveBeenCalledTimes(1));
    // A plan moved on is not taken back by deleting its diary line.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says what a tap did where the tap took its own button away, and takes it back by the way it was given', async () => {
    told.undo.mockResolvedValue(undefined);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'tell' }));

    // Nothing is sent for it: it is said, not written.
    expect(await screen.findByText('The diary stays off.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(told.undo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(reading('Undone · The question is back on Home'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    // No diary line is deleted for it.
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('says so when taking it back was refused, and offers to try again', async () => {
    told.undo.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'tell' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    // The second try shows that it is one, and is answered like the first would have been.
    expect(screen.getByText('taking it back')).toBeInTheDocument();
    await waitFor(() => expect(told.undo).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(reading('Undone · The question is back on Home'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('does not offer to measure a tent with nothing growing in it', async () => {
    const empty = { ...home.spaces[0], grow: null };
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/home' ? { ...home, spaces: [empty] } : answers(path)));
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    // A place nothing grows in is what the line is about, and says so. A reading is written against a grow's own
    // measurements, and a tent by itself has none.
    expect(within(sheet).getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).queryByRole('button', { name: /^Measure/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Water/ })).toBeInTheDocument();
  });

  /**
   * The tent's cam fills the timeline on its own, so the photo entry is the
   * phone's: it opens on the picker, keeps adding rather than replacing, and
   * every picture can be turned or dropped before it goes up.
   */
  it('collects several pictures off the phone, turns and drops them, and uploads each before the line', async () => {
    const filmed = { ...home.spaces[0], latestStill: { mediaId: 'media-1', cameraId: 'camera-1', capturedAt: daysAgo(0) } };
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/home' ? { ...home, spaces: [filmed] } : answers(path)));
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
    URL.revokeObjectURL = vi.fn();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Photo/ }));

    const entry = await screen.findByRole('dialog', { name: 'Photo entry' });
    expect(within(entry).queryByText(/cam still/i)).not.toBeInTheDocument();
    const input = entry.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute('multiple');
    const picture = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [picture('a.jpg'), picture('b.jpg')] } });
    fireEvent.change(input, { target: { files: [picture('c.jpg')] } });
    expect(within(entry).getAllByRole('img')).toHaveLength(3);

    fireEvent.click(within(entry).getByRole('button', { name: 'Remove picture 2' }));
    fireEvent.click(within(entry).getByRole('button', { name: 'Turn picture 2' }));
    expect(within(entry).getAllByRole('img')).toHaveLength(2);

    vi.mocked(api.post).mockImplementation((path: string, body: unknown) =>
      Promise.resolve((path === '/media' ? { id: `media-${((body as FormData).get('file') as File).name}` } : written) as never),
    );
    fireEvent.click(within(entry).getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/entries', expect.objectContaining({ mediaIds: ['media-a.jpg', 'media-c.jpg'] })));
    const uploads = vi
      .mocked(api.post)
      .mock.calls.filter(([path]) => path === '/media')
      .map(([, form]) => (form as FormData).get('rotate'));
    expect(uploads).toEqual([null, '90']);
  });

  /**
   * Nine pictures off a phone take minutes. The toast counts them so it does not
   * look stuck, three go up at once, and Try again sends only what did not arrive.
   */
  it('counts the pictures going up, three at a time, and tries again only the ones that did not arrive', async () => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
    URL.revokeObjectURL = vi.fn();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Photo/ }));
    const entry = await screen.findByRole('dialog', { name: 'Photo entry' });
    const input = entry.querySelector('input[type="file"]') as HTMLInputElement;
    const names = ['a', 'b', 'c', 'd', 'e'];
    fireEvent.change(input, { target: { files: names.map(name => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' })) } });

    const pending: Record<string, (media: { id: string }) => void> = {};
    let refuse = true;
    vi.mocked(api.post).mockImplementation((path: string, body: unknown) => {
      if (path !== '/media') return Promise.resolve(written as never);
      const name = ((body as FormData).get('file') as File).name;
      if (name === 'e.jpg' && refuse) return Promise.reject(new Error('offline')) as never;
      return new Promise(resolve => (pending[name] = resolve)) as never;
    });
    fireEvent.click(within(entry).getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(Object.keys(pending)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']));
    expect(await screen.findByText(/0 of 5 pictures uploaded/)).toBeInTheDocument();
    act(() => pending['a.jpg']({ id: 'media-a' }));
    expect(await screen.findByText(/1 of 5 pictures uploaded/)).toBeInTheDocument();
    act(() => {
      pending['b.jpg']({ id: 'media-b' });
      pending['c.jpg']({ id: 'media-c' });
    });
    await waitFor(() => expect(pending['d.jpg']).toBeDefined());
    act(() => pending['d.jpg']({ id: 'media-d' }));

    expect(await screen.findByText(/Could not save that entry · 4 of 5 pictures uploaded/)).toBeInTheDocument();
    refuse = false;
    vi.mocked(api.post).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(pending['e.jpg']).toBeDefined());
    act(() => pending['e.jpg']({ id: 'media-e' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/entries',
        expect.objectContaining({ mediaIds: ['media-a', 'media-b', 'media-c', 'media-d', 'media-e'] }),
      ),
    );
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/media')).toHaveLength(1);
  });

  it('dates a photo line to when its first picture was taken, where the file says', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Photo/ }));

    const entry = await screen.findByRole('dialog', { name: 'Photo entry' });
    const input = entry.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([jpegTaken('2026:09:15 08:30:00')], 'a.jpg', { type: 'image/jpeg' })] } });

    expect(await within(entry).findByText('Taken from the first picture')).toBeInTheDocument();
    expect(within(entry).getByRole('button', { name: 'Change when: 15 Sep 08:30' })).toBeInTheDocument();

    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve((path === '/media' ? { id: 'media-a' } : written) as never));
    fireEvent.click(within(entry).getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/entries', expect.objectContaining({ mediaIds: ['media-a'] })));
    const [, body] = vi.mocked(api.post).mock.calls.find(([path]) => path === '/entries')!;
    expect((body as { occurredAt: string }).occurredAt).toMatch(/^2026-09-1[45]T/);
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
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open phase there' }));

    const phase = await screen.findByRole('dialog', { name: 'Phase' });
    expect(within(phase).getByText('A phase belongs to a grow, and this entry is about a place.')).toBeInTheDocument();

    fireEvent.click(await within(phase).findByRole('button', { name: 'Place 2: start a grow' }));

    // The form a grow is started with takes this one's place, already about the place asked about.
    expect(await screen.findByRole('dialog', { name: 'Place 2: What grows here?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Phase' })).not.toBeInTheDocument();
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
    expect(within(sheet).getByRole('alert')).toHaveTextContent('The grow or place this link names is not on Home');
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

  it('names the place and what grows there on a chip only where there are several places to tell apart', async () => {
    const balcony = { ...home.spaces[0], spaceId: 'space-2', name: 'Balcony', deviceIds: [], grow: null };
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/home' ? { ...home, spaces: [...home.spaces, balcony] } : answers(path)),
    );
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });

    expect(within(sheet).getByRole('button', { name: 'Tent 1 · Spring run' })).toHaveAttribute('aria-pressed', 'true');
    // A place nothing grows in is itself what a line can be about.
    expect(within(sheet).getByRole('button', { name: 'Balcony' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets the places in one row and the chosen place´s plants in a row of their own', async () => {
    const balcony = { ...home.spaces[0], spaceId: 'space-2', name: 'Balcony', deviceIds: [], grow: null };
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/home' ? { ...home, spaces: [...home.spaces, balcony] } : answers(path)),
    );
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Log' });
    const named = (group: HTMLElement) =>
      within(group)
        .getAllByRole('button')
        .map(chip => chip.textContent);

    const places = within(sheet).getByRole('group', { name: 'What the entry is about' });
    expect(named(places)).toEqual(['Tent 1 · Spring run', 'Balcony']);
    const ofThePlace = within(sheet).getByRole('group', { name: 'Which plant' });
    expect(named(ofThePlace)).toEqual(plants.items.filter(plant => plant.status === 'active').map(plant => plant.label));

    // A plant narrows the line and leaves its place chosen; the other place has no plants to offer.
    fireEvent.click(within(ofThePlace).getByRole('button', { name: 'Gelato 1' }));
    expect(within(places).getByRole('button', { name: 'Tent 1 · Spring run' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(places).getByRole('button', { name: 'Balcony' }));
    expect(within(sheet).queryByRole('group', { name: 'Which plant' })).not.toBeInTheDocument();
  });

  it('leads from a kind´s view back to the tiles it was chosen on', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));

    const note = await screen.findByRole('dialog', { name: 'Note' });
    fireEvent.click(within(note).getByRole('button', { name: 'Back to the choices' }));

    expect(await screen.findByRole('dialog', { name: 'Log' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('writes no note that says nothing', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));

    const note = await screen.findByRole('dialog', { name: 'Note' });
    expect(within(note).getByRole('button', { name: /^Save/ })).toBeDisabled();
    fireEvent.change(within(note).getByRole('textbox'), { target: { value: 'Smells stronger' } });
    expect(within(note).getByRole('button', { name: /^Save/ })).toBeEnabled();
  });

  it('takes the litres as typed, with the comma a German keyboard writes', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    const details = await screen.findByRole('dialog', { name: 'Water' });
    fireEvent.change(within(details).getByRole('textbox', { name: 'Water in litres' }), { target: { value: '4,5' } });
    fireEvent.click(within(details).getByRole('button', { name: /^Save/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', expect.objectContaining({ values: { kind: 'water', litres: 4.5, readings: [] } }));
    // The line lands, and its toast offers what a written line offers.
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('refuses litres that are no number, and more water than a tent takes, with a word', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    const details = await screen.findByRole('dialog', { name: 'Water' });
    const litres = within(details).getByRole('textbox', { name: 'Water in litres' });
    fireEvent.change(litres, { target: { value: 'abc' } });
    // What was typed stays in the field, the reason stands under it, and nothing can be saved.
    fireEvent.blur(litres);
    expect(litres).toHaveValue('abc');
    expect(within(details).getByRole('alert')).toHaveTextContent('That is not a number.');
    expect(within(details).getByRole('button', { name: /^Save/ })).toBeDisabled();

    // 999 L went through as a watering: the bound is the contract's, the one the route holds to too.
    fireEvent.change(litres, { target: { value: '999' } });
    expect(
      within(details)
        .getByRole('alert')
        .textContent?.replace(/\u00a0/g, ' '),
    ).toBe('At most 100 L.');
    expect(within(details).getByRole('button', { name: /^Save/ })).toBeDisabled();

    // No amount at all is refused as well: "-3" once saved a watering of nothing.
    fireEvent.change(litres, { target: { value: '-3' } });
    expect(
      within(details)
        .getByRole('alert')
        .textContent?.replace(/\u00a0/g, ' '),
    ).toBe('More than 0 L.');
    expect(litres).toHaveAttribute('aria-invalid', 'true');
    expect(litres).toHaveAccessibleDescription(/^More.than.0.L\.$/);
    expect(within(details).getByRole('button', { name: /^Save/ })).toHaveAccessibleDescription(/^More.than.0.L\.$/);

    fireEvent.change(litres, { target: { value: '3' } });
    expect(within(details).queryByRole('alert')).not.toBeInTheDocument();
    expect(litres).not.toHaveAttribute('aria-invalid');
    expect(within(details).getByRole('button', { name: /^Save/ })).toBeEnabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  /** A reading that is no number was left out without a word: a figure lost. It is named, and holds the line back. */
  it('refuses a reading it cannot read, by its name, and saves nothing until it is put right', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));

    const details = await screen.findByRole('dialog', { name: 'Water' });
    const field = within(details).getByRole('textbox', { name: 'pH' });
    fireEvent.change(field, { target: { value: 'six' } });

    expect(within(details).getByRole('alert')).toHaveTextContent('pH: that is not a number.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('pH: that is not a number.');
    const save = within(details).getByRole('button', { name: /^Save/ });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('pH: that is not a number.');

    fireEvent.change(field, { target: { value: '6,2' } });
    expect(within(details).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: /^Save/ }));
    expect(api.post).toHaveBeenCalledWith(
      '/entries',
      expect.objectContaining({ values: expect.objectContaining({ readings: [expect.objectContaining({ key: 'ph', value: 6.2 })] }) }),
    );
  });

  /** One grid of equal cells: jsdom lays nothing out, so the rule is read from the sheet's stylesheet. */
  it('draws the tiles as one grid of four equal columns, so a row that is not full is not stretched', () => {
    const css = readFileSync(resolve(__dirname, '../src/log/Log.module.css'), 'utf8');
    const tiles = /\.tiles \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(tiles).toMatch(/display: grid;/);
    expect(tiles).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(/\.tile \{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/flex:/);
  });

  /** A long strain's plants are told apart by the number at the end of their names: a chip wraps, it never cuts it away. */
  it('wraps a long name on a place´s or a plant´s chip rather than cutting off its end', () => {
    const css = readFileSync(resolve(__dirname, '../src/log/Log.module.css'), 'utf8');
    const chip = /\.targets > button \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(chip).toMatch(/white-space: normal;/);
    expect(chip).not.toMatch(/ellipsis|nowrap/);
  });

  it('answers a correction and a line taken back with a toast, once the sheet is gone', async () => {
    vi.mocked(api.patch).mockResolvedValue(lastWater as never);
    vi.mocked(api.delete).mockResolvedValue(undefined as never);
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'correct' }));
    const correction = await screen.findByRole('dialog', { name: 'Water' });
    fireEvent.change(within(correction).getByRole('textbox', { name: 'Water in litres' }), { target: { value: '3' } });
    fireEvent.click(within(correction).getByRole('button', { name: 'Save the correction' }));
    expect(await screen.findByText(reading('Entry corrected'))).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'correct' }));
    const again = await screen.findByRole('dialog', { name: 'Water' });
    fireEvent.click(within(again).getByRole('button', { name: 'Delete this entry' }));
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(reading('Entry deleted'))).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith(`/entries/${lastWater.id}`);
  });

  it('says nothing about a scheme where the grow is fed by none', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/grows/grow-1' ? { ...grow, scheme: null } : answers(path)));
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }));

    const details = await screen.findByRole('dialog', { name: 'Feed' });
    expect(within(details).getByRole('textbox', { name: 'Water in litres' })).toBeInTheDocument();
    expect(within(details).queryByText(/scheme/i)).not.toBeInTheDocument();
  });

  it('offers no moment from before the grow began, says when it began, and moves the start for whoever may', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));

    const note = await screen.findByRole('dialog', { name: 'Note' });
    fireEvent.click(within(note).getByRole('button', { name: /^Change when/ }));
    // The grow began 34 days ago, on 15 August.
    fireEvent.change(within(note).getByLabelText('Date'), { target: { value: '2026-08-10' } });

    expect(within(note).getByRole('status')).toHaveTextContent('The grow only began on 15 Aug 2026.');
    expect(within(note).getByRole('button', { name: 'Apply' })).toBeDisabled();
    // While the pop-up stands on a moment it refuses, the sheet saves nothing: the note was filed under now.
    fireEvent.change(within(note).getByRole('textbox'), { target: { value: 'Topped' } });
    expect(within(note).getByRole('button', { name: /^Save/ })).toBeDisabled();
    // A tap beside it does not put the question away either.
    fireEvent.pointerDown(within(note).getByRole('textbox'));
    expect(within(note).getByLabelText('Date')).toBeInTheDocument();

    vi.mocked(api.patch).mockResolvedValue(grow as never);
    fireEvent.click(within(note).getByRole('button', { name: 'Move the start to 10 Aug 2026' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/grows/grow-1', { startedAt: expect.stringMatching(/^2026-08-(09|10)T/) }));
    // The moment is taken once the grow reaches back to it.
    expect(await within(note).findByRole('button', { name: /^Change when: 10 Aug \d\d:\d\d$/ })).toBeInTheDocument();

    // The start moved is answered with the day it is now, and the start it had is one write away.
    expect(await screen.findByText(reading(/^Start: (9|10) Aug 2026/))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/grows/grow-1', { startedAt: grow.startedAt }));
  });

  it('says there is no connection, keeps the moment the line was written at, and sends it by itself once the connection is back', async () => {
    // What a browser answers a request that never got out with.
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Water' })).getByRole('button', { name: /^Save/ }));

    expect(await screen.findByText('No connection · it is sent as soon as there is one')).toBeInTheDocument();
    const [, first] = vi.mocked(api.post).mock.calls[0];

    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    act(() => void window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    // The same line, dated when it was written and not an hour later.
    expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(first);
    expect((first as { occurredAt: string }).occurredAt).toBe(NOW.toISOString());
    await waitFor(() => expect(screen.queryByText(/No connection/)).not.toBeInTheDocument());
  });

  it('answers a phase set from its tile with a toast that says what changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ schemes: [] }) })),
    );
    vi.mocked(api.post).mockResolvedValue({ id: 'phase-new' } as never);
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Phase/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Phase' })).getByRole('button', { name: /^Save/ }));

    expect(await screen.findByText(reading(/^Entered Drying · Spring run/))).toBeInTheDocument();
  });

  it('writes a line about one plant when a plant is the target', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Gelato 1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Water/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Water' })).getByRole('button', { name: /^Save/ }));

    expect(api.post).toHaveBeenCalledWith('/entries', {
      kind: 'water',
      growId: 'grow-1',
      spaceId: undefined,
      plantIds: ['plant-2'],
      // Dated when it was written, so a line that only gets through later is still of that moment.
      occurredAt: expect.any(String),
      text: undefined,
      values: { kind: 'water', litres: 2, readings: [] },
    });
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
  });
});
