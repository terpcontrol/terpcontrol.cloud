import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { LogProvider } from '@/log/LogProvider';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, GrowWeekCard, Media, MediaRenderStatus } from '@fg2/shared-types/v1';
import { exportFilename } from '@/api/exports';
import { GrowArchive } from '@/screens/grow/Archive';
import { GrowHeader } from '@/screens/grow/GrowPage';
import { PhaseBar } from '@/screens/grow/PhaseBar';
import { Report } from '@/screens/grow/Report';
import { NoLongerHere } from '@/ui/PageState';
import { WeekCard } from '@/screens/grow/WeekCard';
import { ON_THE_DEMO, SIGNED_IN } from './session';

// A picture's address needs the session's media token, and what a screen offers
// depends on who is looking, so both are answered here rather than reached for.
const session = { user: SIGNED_IN };

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  mediaUrl: (id: string) => `/media/${id}`,
  useSession: () => session.user,
}));

/**
 * The grow page draws what the server worked out and nothing else: the phase
 * bar from the grow's phases, the week card from its own answer - averages,
 * the scheme's feeding with its done count, the readings with their change,
 * the week's lines with who wrote them.
 */

const NOW = DateTime.fromISO('2026-09-18T12:00:00.000Z');
const at = (daysAgo: number, hour = 10) => NOW.minus({ days: daysAgo }).set({ hour }).toISO()!;

const grow: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  description: null,
  type: 'photoperiod',
  phases: [
    {
      id: 'p1',
      stage: 'vegetative',
      preset: null,
      startedAt: at(34),
      source: 'human',
      plantIds: null,
      deviceId: null,
      targets: null,
      setBy: 'user-1',
    },
    {
      id: 'p2',
      stage: 'flowering',
      preset: 'flower',
      startedAt: at(10),
      source: 'preset',
      plantIds: null,
      deviceId: null,
      targets: null,
      setBy: null,
    },
  ],
  placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: at(34), endedAt: null, plantIds: null }],
  scheme: {
    origin: { type: 'asset', assetId: 'biobizz', version: '1' },
    strength: 1,
    waterEc: null,
    plantType: 'soil',
    flipWeek: 4,
    edited: false,
    grid: [],
  },
  measurements: [
    { key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: null, chart: true },
    { key: 'ph', name: 'pH', unit: '', perPlant: false, targetMin: 6.3, targetMax: 6.3, chart: true },
  ],
  visibility: 'private',
  slug: 'spring-run',
  coverMediaId: null,
  filmMediaId: null,
  startedAt: at(34),
  endedAt: null,
  isDemo: false,
  createdAt: at(34),
  updatedAt: at(0),
  summary: {
    dayNumber: 35,
    stage: 'flowering',
    preset: 'flower',
    phaseDay: 11,
    stageWeek: 2,
    weekNumber: 5,
    isAuto: true,
    groups: [],
    locations: [{ spaceId: 'space-1', plantIds: ['plant-1'] }],
  },
};

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1',
  createdAt: at(1),
  kind: 'water',
  occurredAt: at(1),
  source: 'human',
  authorId: 'user-anna',
  growId: 'grow-1',
  spaceId: 'space-1',
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
  ...over,
});

const week: GrowWeekCard = {
  weekNumber: 5,
  dayFrom: 29,
  dayTo: 35,
  startsAt: at(6),
  endsAt: at(0),
  stage: 'flowering',
  preset: 'flower',
  stageWeek: 2,
  deviceIds: ['device-1'],
  climate: [
    { metric: 'temperature', minValue: 20, maxValue: 27, averageValue: 23.6, dayAverage: 26.4, nightAverage: 20.8 },
    { metric: 'humidity', minValue: 55, maxValue: 66, averageValue: 60.2, dayAverage: 62, nightAverage: 58 },
  ],
  lightHours: 12.2,
  days: Array.from({ length: 7 }, (_, index) => ({
    dayNumber: 29 + index,
    startsAt: at(6 - index, 0),
    // The grow flipped to flower on the third day of this week.
    stage: index === 2 ? ('flowering' as const) : null,
    mediaId: index === 6 ? 'media-1' : null,
    cameraId: index === 6 ? 'cam-1' : null,
    capturedAt: index === 6 ? at(0) : null,
  })),
  feeding: {
    amounts: [
      { productKey: 'bloom', name: 'Bio·Bloom', value: 2, unit: 'ml/l' },
      { productKey: 'topmax', name: 'Top·Max', value: 1, unit: 'ml/l' },
      { productKey: 'grow', name: 'Bio·Grow', value: null, unit: 'ml/l' },
    ],
    plannedCount: 3,
  },
  readings: [
    { key: 'height', value: 58, change: 6, measuredAt: at(2) },
    { key: 'ph', value: 6.3, change: null, measuredAt: at(2) },
  ],
  waterCount: 1,
  feedCount: 2,
  entries: [entry({}), entry({ id: 'e2', kind: 'training', text: 'Defoliated', occurredAt: at(2), values: { kind: 'training' } })],
  entryCount: 4,
  timelapseMediaId: null,
};

const people = [{ id: 'user-anna', handle: 'anna' }];

const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        {/* A week card and a report chapter open a line to be corrected, which is the shell's sheet. */}
        <LogProvider>{node}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

/**
 * The export is a job rather than a file: the button asks for it, the row it
 * names is polled, and only a row that is ready is offered as something to
 * download. The wire is stubbed rather than the hooks, because the point is
 * which requests the screen makes and in what order.
 */
const EXPORT_ROW = (status: MediaRenderStatus, error: string | null = null): Media =>
  ({
    id: 'media-export',
    createdAt: at(0),
    kind: 'export',
    mime: 'application/zip',
    bytes: 12_582_912,
    capturedAt: at(0),
    exportJob: { status, scope: 'grow', growId: 'grow-1', startedAt: null, endedAt: null, error },
    render: null,
  }) as unknown as Media;

const wire = { calls: [] as string[], job: EXPORT_ROW('queued'), grows: [] as GrowListItem[], entries: [] as Entry[] };

const jsonOf = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
    wire.calls.push(path);

    if (path === '/grows/grow-1/report') {
      return jsonOf({ dayCount: 35, totals: { entryCount: 4, waterCount: 1, feedCount: 2, photoCount: 1 }, harvest: null, phases: [], people: [] });
    }
    if (path === '/grows') return jsonOf({ items: wire.grows, nextCursor: null });
    if (path === '/entries') return jsonOf({ items: wire.entries, nextCursor: null });
    if (path === '/spaces') return jsonOf({ items: [{ id: 'space-1', name: 'Tent 1', kind: 'tent', roomId: null }], nextCursor: null });
    if (path === '/grows/grow-1/export') return jsonOf({ media: wire.job, queued: true }, 202);
    if (path === '/media/media-export') return jsonOf(wire.job);

    return jsonOf({ status: 404, code: 'not_found', title: 'not_found', detail: `No stub for ${path}`, errors: [] }, 404);
  }),
);

beforeEach(() => {
  wire.calls = [];
  wire.job = EXPORT_ROW('queued');
  wire.grows = [];
  wire.entries = [];
  session.user = SIGNED_IN;
});

describe('the report tab', () => {
  // Getting a whole grow out as a zip is the owner's; the grow page works out
  // whose the grow is and hands the answer down.
  const drawReport = (mayOwn = true) => draw(<Report grow={grow} spaces={[]} mayOwn={mayOwn} now={NOW} />);

  it('asks for the zip and says where the job has got to, with nothing to download until there is', async () => {
    wire.job = EXPORT_ROW('rendering');
    drawReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Export this grow' }));

    expect(await screen.findByRole('status')).toHaveTextContent('building the file');
    expect(wire.calls).toContain('/grows/grow-1/export');
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });

  /**
   * The row an export lives on names no grow: an export is the account's own
   * copy of what it can see, and hanging it off a grow would put a zip among
   * that grow's pictures. So the name is read from the job, and reading it from
   * the row called every grow export an export of the whole account - two of
   * them on one day overwriting each other in the download folder.
   */
  it('names the saved file after what was exported', () => {
    const ofTheGrow = EXPORT_ROW('ready');
    expect(ofTheGrow.growId).toBeUndefined();
    expect(exportFilename(ofTheGrow)).toBe(`terp-control-grow-${at(0).slice(0, 10)}.zip`);

    const ofTheAccount = { ...ofTheGrow, exportJob: { ...ofTheGrow.exportJob!, scope: 'account' as const, growId: null } };
    expect(exportFilename(ofTheAccount)).toBe(`terp-control-account-${at(0).slice(0, 10)}.zip`);
  });

  it('offers the file itself once the job is ready, at the size it will cost', async () => {
    wire.job = EXPORT_ROW('ready');
    drawReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Export this grow' }));

    // A button rather than a link: the zip is served to a session, so the bytes
    // are fetched with the token and handed to a download the app makes itself.
    expect(await screen.findByRole('button', { name: /Download/ })).toHaveTextContent('12.0 MB');
  });

  /**
   * The size is a figure a person reads, so it is written in the language the
   * app is being read in - not in the browser's, which on an English machine
   * with the app switched to Deutsch is the other one. This button wrote
   * "171.9 MB" under chapter lines of its own reading "18,5 °C · 66 %", because
   * it was the one caller that never told the formatter which language it was
   * in. It now tells nobody anything, and the writer asks the app.
   */
  it('writes the size with the decimal the app is being read in, not the browser´s', async () => {
    const german = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/de.json'), 'utf8'));
    i18next.addResourceBundle('de', 'translation', german);
    await i18next.changeLanguage('de');

    try {
      wire.job = EXPORT_ROW('ready');
      drawReport();
      fireEvent.click(await screen.findByRole('button', { name: 'Diesen Grow exportieren' }));

      expect(await screen.findByRole('button', { name: /Herunterladen/ })).toHaveTextContent('12,0 MB');
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  /** A diary of a fortnight is a few dozen kilobytes, and "0.0 MB" would read as an export that came out empty. */
  it('gives a small zip its own unit rather than rounding it away to nothing', async () => {
    wire.job = { ...EXPORT_ROW('ready'), bytes: 44_512 };
    drawReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Export this grow' }));

    expect(await screen.findByRole('button', { name: /Download/ })).toHaveTextContent('43 kB');
  });

  it('says in the builder\u2019s own words why a zip could not be built, rather than building for ever', async () => {
    wire.job = EXPORT_ROW('failed', 'The pictures could not be read.');
    drawReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Export this grow' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The pictures could not be read.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  /** A demo session, and a member of somebody's tent, own nothing to export, so the tab offers them nothing. */
  it('offers somebody who does not own the grow no export at all', async () => {
    session.user = ON_THE_DEMO;
    drawReport(false);

    expect(await screen.findByText('35')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export this grow' })).not.toBeInTheDocument();
  });
});

describe('the phase bar', () => {
  it('names every stage, fills only the ones the grow has been through and says how long each took', () => {
    const { container } = draw(<PhaseBar grow={grow} now={NOW} />);

    // The grow began in veg: it never germinated here, so the bar does not say it did.
    const segments = container.querySelectorAll('[data-reached]');
    expect(segments).toHaveLength(6);
    expect([...segments].map(segment => segment.getAttribute('data-reached'))).toEqual(['false', 'false', 'true', 'true', 'false', 'false']);
    expect(container).toHaveTextContent('Germ');
    expect(container).toHaveTextContent('Veg24 d');
    expect(container).toHaveTextContent('Flowerday 11');
    expect(container).toHaveTextContent('Cure');
  });

  it('counts a stage in the grow´s own whole days, the same days the report´s chapters are told in', () => {
    // The flip was pressed at two in the morning rather than on the hour the
    // grow's own day turns over. Rounding the elapsed milliseconds made veg a
    // day longer than the chapter beneath it on the same screen said.
    const flipped: GrowListItem = {
      ...grow,
      phases: [grow.phases[0], { ...grow.phases[1], startedAt: at(10, 2) }],
      summary: { ...grow.summary, phaseDay: 12 },
    };

    const { container } = draw(<PhaseBar grow={flipped} now={NOW} />);

    // Day 1 begins with the veg phase and the flip falls inside day 24, so veg
    // is days 1 to 23 and flowering begins on day 24. The bar's own segments and
    // the day the server counts for the stage are the same 35 days between them:
    // the counter the current segment draws is a day of the grow like the rest.
    expect(container).toHaveTextContent('Veg23 d');
    expect(container).toHaveTextContent('Flowerday 12');
  });
});

describe('a grow that has ended', () => {
  const finished: GrowListItem = {
    ...grow,
    endedAt: at(0, 15),
    summary: { ...grow.summary, dayNumber: 35, stageWeek: 2, phaseDay: 11 },
  };

  it('says on its own page that it is over, and dates the figures it froze', () => {
    draw(<GrowHeader grow={finished} plants={[]} spaces={[]} now={NOW} onShare={null} />);

    expect(screen.getByText('ended 18 Sep 2026')).toBeInTheDocument();
    // The counter is the same 35 a running grow would draw, so the label is what
    // says it stopped there rather than carrying on today.
    expect(screen.getByText('final day')).toBeInTheDocument();
  });

  it('says nothing about plants where the record carries none, rather than counting zero of them', () => {
    // A migrated grow holds no plants by decision and its Plants tab says so in
    // words. "0 plants" in the header says something else: that they were
    // entered and are all gone.
    draw(<GrowHeader grow={finished} plants={[]} spaces={[]} now={NOW} onShare={null} />);

    expect(screen.queryByText(/0 plants/)).not.toBeInTheDocument();
  });

  it('names the tent it stood in, which its own report names on every chapter', () => {
    // An ended grow has no open placement, so "where the plants are" is empty
    // and the slot the header draws a place in was left blank.
    const moved: GrowListItem = { ...finished, summary: { ...finished.summary, locations: [] } };
    draw(<GrowHeader grow={moved} plants={[]} spaces={[{ id: 'space-1', name: 'Tent 1' } as never]} now={NOW} onShare={null} />);

    expect(screen.getByRole('link', { name: 'stood in Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    // And it keeps the way to its charts: the tent page lists only the grows
    // standing there now, so this is the ended grow's one route to them.
    expect(screen.getByRole('link', { name: 'Charts' })).toHaveAttribute('href', '/charts?grow=grow-1');
  });

  it('is drawn as standing in no stage, so the bar claims no present it does not have', () => {
    const { container } = draw(<PhaseBar grow={finished} now={NOW} />);

    expect(container.querySelectorAll('[data-current="true"]')).toHaveLength(0);
    expect(screen.getByRole('img')).toHaveAccessibleName('Phase progress, ended in Flower');
    // The stage it finished in says how long it lasted, like every stage before it.
    expect(container).toHaveTextContent('Flower11 d');
  });

  it('draws a running grow as being in one, which is what the ended state is told against', () => {
    const { container } = draw(<PhaseBar grow={grow} now={NOW} />);

    expect(container.querySelectorAll('[data-current="true"]')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAccessibleName('Phase progress, now in Flower');
  });
});

/**
 * A figure typed wrongly is typed wrongly on the row that carries it, and until
 * the row was a way back into the line the only screen in the app that opened
 * one was a plant's page - which no grow brought over from the old app has.
 */
describe('correcting a line a week card is drawing', () => {
  it('opens the line in the sheet it was written in', async () => {
    draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    fireEvent.click(screen.getByRole('button', { name: /Defoliated/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('leaves what a machine recorded inert, because that is not ours to rewrite', () => {
    const alarm = entry({
      id: 'e3',
      kind: 'alarm',
      source: 'device',
      authorId: null,
      message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), value=31.2'] },
    });

    draw(<WeekCard week={{ ...week, entries: [alarm], entryCount: 1 }} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByText('Alarm triggered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alarm triggered/ })).not.toBeInTheDocument();
  });

  it('offers no way in on the demo, which reads the whole account and writes nothing to it', () => {
    session.user = ON_THE_DEMO;

    draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Defoliated/ })).not.toBeInTheDocument();
  });
});

describe('the last card of a grow that has ended', () => {
  it('draws the days after its end as days it never lived, not as days like any other', () => {
    // The grow came down on the Wednesday of its last week. The card is still
    // seven days wide - that is what the week is - so the tiles are where it
    // says how much of it happened, and four of them did not.
    const finished: GrowListItem = { ...grow, endedAt: at(4, 15) };

    const { container } = draw(<WeekCard week={week} grow={finished} people={people} now={NOW} current={false} />);

    const lived = [...container.querySelectorAll('[data-future]')].map(tile => tile.getAttribute('data-future'));
    expect(lived).toEqual(['false', 'false', 'false', 'true', 'true', 'true', 'true']);
  });

  it('stamps its lines with the grow-day, because a card seven days wide holds one weekday twice', () => {
    // The week opens at ten on a Saturday morning and closes at ten on the
    // Saturday after, so its first and its last day are the same weekday and a
    // bare one told the two rows apart in no way at all.
    const twice = {
      ...week,
      entries: [entry({ id: 'last', occurredAt: at(-1, 9) }), entry({ id: 'first', occurredAt: at(6, 11) })],
      entryCount: 2,
    };

    draw(<WeekCard week={twice} grow={grow} people={people} now={NOW} current />);

    // With the date, because the grow-day the stamp names straddles two of
    // them: two lines either side of that boundary carry hours that run
    // backwards against the order the card lists them in.
    expect(screen.getByText('D 35 · 19 Sep 09:00')).toBeInTheDocument();
    expect(screen.getByText('D 29 · 12 Sep 11:00')).toBeInTheDocument();
  });

  it('names each tile after the grow-day it is rather than after the weekday it opens on', () => {
    // A grow-day begins at the hour the grow began, so a tile covers the tail
    // of one date and the head of the next and belongs to neither. Named after
    // the date it opened on, the tile carrying a stage marker was the day
    // before the line on this same card that announces that stage.
    const evening = { ...week, days: week.days.map((day, index) => ({ ...day, startsAt: at(6 - index, 22) })) };

    draw(<WeekCard week={evening} grow={grow} people={people} now={NOW} current />);

    const tiles = screen
      .getAllByRole('listitem')
      .slice(0, 7)
      .map(tile => tile.textContent ?? '');
    expect(tiles.map(text => text.replace('Flower', ''))).toEqual(['D 29', 'D 30', 'D 31', 'D 32', 'D 33', 'D 34', 'D 35']);
  });

  it('marks on the day strip the stage the grow entered inside the week, which the pill cannot say', () => {
    // The pill names the stage the week ended in. A week that held two - three
    // for a grow that germinated, sprouted and went to veg in seven days - said
    // nothing about the ones before the last.
    draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    const marks = screen.getAllByRole('listitem').map(tile => tile.textContent);
    expect(marks.filter(text => text?.includes('Flower'))).toHaveLength(1);
    expect(marks[2]).toContain('Flower');
  });

  it('says of an empty week that nothing was logged, rather than that nothing has been yet', () => {
    const finished: GrowListItem = { ...grow, endedAt: at(4, 15) };
    const empty = { ...week, entries: [], entryCount: 0 };

    const { unmount } = draw(<WeekCard week={empty} grow={finished} people={people} now={NOW} current />);
    expect(screen.getByText('Nothing was logged this week')).toBeInTheDocument();
    unmount();

    // Nothing can be logged into a finished grow at all - it is on no Log
    // sheet's targets - while an earlier week of a running one still can be.
    draw(<WeekCard week={empty} grow={grow} people={people} now={NOW} current />);
    expect(screen.getByText('Nothing logged this week yet')).toBeInTheDocument();
  });

  it('draws a running grow´s days against now, which is what the ended case is told against', () => {
    const { container } = draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    expect([...container.querySelectorAll('[data-future]')].map(tile => tile.getAttribute('data-future'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
  });
});

describe('a week with more lines than the card carries', () => {
  it('reads the rest into the card itself, because no other screen can be pointed at them', async () => {
    wire.entries = [
      ...week.entries,
      entry({ id: 'e-hidden', kind: 'note', text: 'Runtergebunden', occurredAt: at(3), values: { kind: 'note' } }),
      entry({ id: 'e-hidden-2', kind: 'note', text: '1. Mal getoppt', occurredAt: at(4), values: { kind: 'note' } }),
    ];
    draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    const more = screen.getByRole('button', { name: '+ 2 more' });
    fireEvent.click(more);

    expect(await screen.findByText('Runtergebunden')).toBeInTheDocument();
    expect(screen.getByText('1. Mal getoppt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
    // Asked for the week's own window and the diary's own kinds, so what comes
    // back is exactly what the card said was missing.
    expect(wire.calls).toContain('/entries');
  });
});

describe('the pictures a diary line carries', () => {
  it('draws them on the week card, whatever kind of line they hang on', () => {
    // A migrated diary hangs its pictures on the note or the phase line they
    // belonged to; until the row drew them the only screen in the app reading
    // `mediaIds` was a plant's own page, which a migrated grow has none of.
    const pictured = { ...week, entries: [entry({ id: 'e-pics', kind: 'note', mediaIds: ['media-7', 'media-8'] })] };

    draw(<WeekCard week={pictured} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByAltText('Picture 1 of 2')).toHaveAttribute('src', '/media/media-7');
    expect(screen.getByAltText('Picture 2 of 2')).toHaveAttribute('src', '/media/media-8');
  });
});

describe('the archive', () => {
  const finished: GrowListItem = { ...grow, id: 'grow-old', name: 'Autumn run', endedAt: at(20, 15), summary: { ...grow.summary, dayNumber: 14 } };

  it('lists a grow that has ended and links to its diary, which nothing else in the app does', async () => {
    wire.grows = [grow, finished];
    draw(<GrowArchive />);

    const row = await screen.findByRole('link', { name: /Autumn run/ });
    expect(row).toHaveAttribute('href', '/grows/grow-old/weeks');
    expect(row).toHaveTextContent('15 Aug 2026 → 29 Aug 2026');
    // The grow that is still running belongs on the home, not here.
    expect(screen.queryByText('Spring run')).not.toBeInTheDocument();
    expect(screen.getByText('1 finished grow')).toBeInTheDocument();
  });

  it('says an account with nothing finished has nothing rather than drawing an empty list', async () => {
    wire.grows = [grow];
    draw(<GrowArchive />);

    expect(await screen.findByText(/Nothing finished yet/)).toBeInTheDocument();
  });

  it('is what stops the page for a grow somebody cannot reach blaming the grow for having ended', async () => {
    // The archive is one tap away and opens a finished grow in full, so a page
    // that explained a 404 by the grow having ended would be contradicted by
    // the screen beside it - and would point the person who was really taken
    // out of a tent at a cause this app does not have.
    wire.grows = [grow, finished];
    draw(
      <>
        <NoLongerHere what="grow" />
        <GrowArchive />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This grow is not shared with you.');
    expect(screen.getByText(/Whoever shares it has taken you out/)).toBeInTheDocument();
    expect(screen.queryByText(/has ended/)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Autumn run/ })).toBeInTheDocument();
  });
});

describe('a week card', () => {
  it('draws the week, its averages, the feeding with its done count, the readings and the entries', () => {
    draw(<WeekCard week={week} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByText('Week 5')).toBeInTheDocument();
    expect(screen.getByText(/day 29–35/)).toHaveTextContent('this week');
    expect(screen.getByText('Flower wk 2')).toBeInTheDocument();
    expect(screen.getByText('26.4 / 20.8')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    // The scheme's row with the grow's strength applied, "not this week" left out, and how many feeds were done.
    expect(screen.getByText('Bio·Bloom 2 ml/l · Top·Max 1 ml/l')).toBeInTheDocument();
    expect(screen.getByText('2 / 3 done')).toHaveAttribute('data-complete', 'false');

    // Readings by their definition's name and unit, with the change where there is one.
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(screen.getByText(/pH/)).toBeInTheDocument();

    // Seven days, one with a picture.
    expect(screen.getAllByRole('listitem').filter(item => item.querySelector('img'))).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(1);

    expect(screen.getAllByText('anna')).toHaveLength(2);
    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 2 more' })).toBeInTheDocument();
  });

  it('says why there is nothing to average where no controller stands, rather than drawing dashes', () => {
    draw(<WeekCard week={{ ...week, deviceIds: [], climate: [], lightHours: null }} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByText('No controller where this grow stands · nothing to average')).toBeInTheDocument();
    expect(screen.queryByText('–')).not.toBeInTheDocument();
  });

  it('says a controller measured nothing this week, which is not the same as having none', () => {
    draw(<WeekCard week={{ ...week, climate: [], lightHours: null }} grow={grow} people={people} now={NOW} current />);

    expect(screen.getByText('Nothing measured this week')).toBeInTheDocument();
  });

  it('folds a past week to its pictures and figures, and opens on a tap', () => {
    draw(<WeekCard week={{ ...week, weekNumber: 4 }} grow={grow} people={people} now={NOW} current={false} />);

    expect(screen.queryByText('Defoliated')).not.toBeInTheDocument();
    expect(screen.getByText('26.4 / 20.8')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { expanded: true })).getByText('Week 4')).toBeInTheDocument();
  });
});
