import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { LogProvider } from '@/log/LogProvider';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowDiaryDay, GrowDiaryWeek, GrowListItem, Media, MediaRenderStatus } from '@fg2/shared-types/v1';
import { exportFilename } from '@/api/exports';
import { mediaUrl } from '@/api/session';
import { useCorrecting } from '@/log/corrections';
import { DayCard } from '@/screens/grow/diary/DayCard';
import { dayLines, dayTitle, shownLines, type DiaryReader } from '@/screens/grow/diary/days';
import { Diary } from '@/screens/grow/diary/Diary';
import { forgetKept } from '@/ui/kept';
import { growStanding } from '@/ui/session-access';
import { GrowHead } from '@/screens/grow/GrowPage';
import { Pictures } from '@/screens/grow/pictures/Pictures';
import { Report } from '@/screens/grow/Report';
import { drawAt, json, reading } from './harness';
import { ON_THE_DEMO, SIGNED_IN } from './session';
import { catalogue, translate } from './translations';

// A picture's address needs the session's media token, and what a screen offers
// depends on who is looking, so both are answered here rather than reached for.
const session = { user: SIGNED_IN };

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  mediaUrl: (id: string) => `/media/${id}`,
  useSession: () => session.user,
}));

/**
 * The grow page draws what the server worked out and nothing else: its head
 * from the grow's summary, a day of the diary from the server's own answer -
 * the picture, the climate and the share inside its targets, what the devices
 * did and the day's lines with who wrote them.
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
    zone: 'UTC',
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

/** A day of the diary as the server answers it: `back` dates ago, numbered as the grow's day. */
const day = (back: number, over: Partial<GrowDiaryDay> = {}): GrowDiaryDay => ({
  date: NOW.minus({ days: back }).toISODate()!,
  dayNumber: 35 - back,
  startsAt: NOW.minus({ days: back }).startOf('day').toISO()!,
  endsAt:
    back === 0
      ? NOW.toISO()!
      : NOW.minus({ days: back - 1 })
          .startOf('day')
          .toISO()!,
  still: null,
  climate: null,
  events: [],
  entries: [],
  ...over,
});

const diaryWeek = (weekNumber: number, days: GrowDiaryDay[], over: Partial<GrowDiaryWeek> = {}): GrowDiaryWeek => ({
  weekNumber,
  dayFrom: weekNumber * 7 - 6,
  dayTo: weekNumber * 7,
  stage: 'flowering',
  preset: null,
  stageWeek: weekNumber - 3,
  film: null,
  days,
  ...over,
});

const people = [{ id: 'user-anna', handle: 'anna' }];

// A day of the diary and a report chapter open a line to be corrected, which is the shell's sheet.
const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

beforeAll(() => translate());

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

const REPORT = { dayCount: 35, totals: { entryCount: 4, waterCount: 1, feedCount: 2, photoCount: 1 }, harvest: null, phases: [], people: [] };

const wire = {
  calls: [] as string[],
  /** The same requests with what each asked for. */
  asked: [] as string[],
  writes: [] as { method: string; path: string; body: unknown }[],
  job: EXPORT_ROW('queued'),
  grows: [] as GrowListItem[],
  entries: [] as Entry[],
  report: REPORT as unknown,
  /** The diary's pages by cursor; the first under ''. */
  diary: {} as Record<string, { items: GrowDiaryWeek[]; nextCursor: string | null; people: { id: string; handle: string }[]; earlier?: Entry[] }>,
};

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/v1/, '');
    wire.calls.push(path);
    wire.asked.push(`${path}${url.search}`);
    if (init?.method && init.method !== 'GET') {
      wire.writes.push({ method: init.method, path, body: JSON.parse(String(init.body)) });
      return json(path === '/entries' ? entry({ id: 'written' }) : { ...grow, ...(JSON.parse(String(init.body)) as object) });
    }

    if (path === '/grows/grow-1/diary')
      return json({ earlier: [], ...(wire.diary[url.searchParams.get('cursor') ?? ''] ?? { items: [], nextCursor: null, people: [] }) });

    if (path === '/grows/grow-1/report') return json(wire.report);
    if (path === '/grows') return json({ items: wire.grows, nextCursor: null });
    if (path === '/entries') return json({ items: wire.entries, nextCursor: null });
    if (path === '/spaces') return json({ items: [{ id: 'space-1', name: 'Tent 1', kind: 'tent', roomId: null }], nextCursor: null });
    if (path === '/grows/grow-1') return json(grow);
    if (path === '/grows/grow-1/export') return json({ media: wire.job, queued: true }, 202);
    if (path === '/media/media-export') return json(wire.job);

    return json({ status: 404, code: 'not_found', title: 'not_found', detail: `No stub for ${path}`, errors: [] }, 404);
  }),
);

beforeEach(() => {
  wire.calls = [];
  wire.writes = [];
  wire.diary = {};
  wire.asked = [];
  forgetKept();
  wire.job = EXPORT_ROW('queued');
  wire.report = REPORT;
  wire.grows = [];
  wire.entries = [];
  session.user = SIGNED_IN;
});

describe('the report tab', () => {
  // Getting a whole grow out as a zip is the owner's; the grow page works out
  // whose the grow is and hands the answer down.
  const drawReport = (mayOwn = true) => draw(<Report grow={grow} spaces={[]} mayOwn={mayOwn} now={NOW} picturesTo="/grow/pictures" />);

  /**
   * A chapter states how the tent was kept, the hours of light among it. They
   * were the figure it once dropped: the server measures the lamp's
   * switchings to split the day from the night averages beside them, so the
   * photoperiod was worked out for every chapter and then thrown away.
   */
  it('states the hours of light of the chapter, beside the climate it was kept at', async () => {
    wire.report = {
      ...REPORT,
      phases: [
        {
          phaseId: 'phase-1',
          stage: 'flowering',
          preset: 'flower',
          startedAt: at(10),
          endedAt: null,
          dayFrom: 25,
          dayTo: null,
          dayCount: 11,
          spaceIds: [],
          coverMediaId: null,
          climate: [
            { metric: 'temperature', minValue: 20, maxValue: 27, averageValue: 23.6, dayAverage: 26.4, nightAverage: 20.8 },
            { metric: 'humidity', minValue: 55, maxValue: 66, averageValue: 60.2, dayAverage: 62, nightAverage: 58 },
          ],
          lightHours: 12.2,
          inBandPercent: 91,
          waterCount: 1,
          feedCount: 2,
          training: [
            entry({
              id: 'trained',
              kind: 'training',
              text: 'Lower shoots defoliated',
              authorId: 'user-1',
              occurredAt: at(2, 9),
              values: { kind: 'training' },
            }),
          ],
        },
      ],
    };
    drawReport();

    // Read as the line reads: the figures are facts side by side, each whole, and "in band" is a term of its own.
    expect(await screen.findByText(reading('26.4 / 20.8 °C · 60 % · 12 h · 91 % in band'))).toBeInTheDocument();
    // What was trained is a line of the diary, as a day's card draws it: the day in words, its date, and what was done.
    const trained = screen.getByRole('listitem');
    expect(trained.textContent?.replace(/\u00a0/g, ' ')).toMatch(/^Day \d+ · \d+ \w+Training: Lower shoots defoliated/);
    expect(within(trained).getByRole('button', { name: /Lower shoots defoliated/ })).toBeInTheDocument();
  });

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
    i18next.addResourceBundle('de', 'translation', await catalogue('de'));
    await i18next.changeLanguage('de');

    try {
      wire.job = EXPORT_ROW('ready');
      drawReport();
      fireEvent.click(await screen.findByRole('button', { name: 'Diesen Grow exportieren' }));

      expect(await screen.findByRole('button', { name: /Herunterladen/ })).toHaveTextContent('12,0 MB');
    } finally {
      // The screen is still up, and every line of it is redrawn in English.
      await act(() => i18next.changeLanguage('en'));
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

describe('the head of a grow´s page', () => {
  const tent = [{ id: 'space-1', name: 'Tent 1' } as never];

  it('says the day, the phase with its week and where the grow stands, over the bar of how far it has come', () => {
    draw(<GrowHead grow={grow} spaces={tent} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Spring run' })).toBeInTheDocument();
    expect(screen.getByText('Day 35')).toBeInTheDocument();
    expect(screen.getByText(/Flower/)).toBeInTheDocument();
    expect(screen.getByText('week 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    expect(screen.getByRole('img')).toHaveAccessibleName('Phase progress, now in Flower');
  });

  it('is one head under both of the grow´s addresses: the way to every grow beside its name, and nothing leading back', () => {
    draw(<GrowHead grow={grow} spaces={tent} />);

    expect(screen.getByRole('link', { name: 'All grows' })).toHaveAttribute('href', '/grows');
    expect(screen.queryByRole('link', { name: /^Back to/ })).not.toBeInTheDocument();
  });

  describe('of a grow that has ended', () => {
    const finished: GrowListItem = { ...grow, endedAt: at(0, 15), summary: { ...grow.summary, locations: [] } };

    it('says how long it ran and the day it ended, rather than a day it is on', () => {
      draw(<GrowHead grow={finished} spaces={tent} />);

      expect(screen.getByText('35 days · ended 18 Sep 2026')).toBeInTheDocument();
      expect(screen.queryByText('Day 35')).not.toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAccessibleName('Phase progress, ended in Flower');
    });

    it('names the tent it stood in, which its own report names on every chapter', () => {
      // An ended grow has no open placement, so "where the plants are" is empty.
      draw(<GrowHead grow={finished} spaces={tent} />);

      expect(screen.getByRole('link', { name: 'stood in Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    });
  });
});

describe('what a day of the diary is called', () => {
  const t = (key: string, values?: Record<string, unknown>) => i18next.t(key, values);
  const today = NOW.toISODate()!;

  it('is today, yesterday, then the weekday while a weekday names one day, then the date', () => {
    expect(dayTitle(t as never, day(0), today)).toBe('Today · Day 35');
    expect(dayTitle(t as never, day(1), today)).toBe('Yesterday · Day 34');
    // 18 September 2026 is a Friday.
    expect(dayTitle(t as never, day(2), today)).toBe('Wednesday · Day 33');
    expect(dayTitle(t as never, day(6), today)).toBe('Saturday · Day 29');
    expect(dayTitle(t as never, day(7), today)).toBe('Fri 11 Sep · Day 28');
  });
});

/** A name as it reads: a figure is bound to the word after it so that no line ends on one, and the dot between two facts stands between them. */
const reads = (pattern: RegExp) => (name: string) => pattern.test(name.replace(/\u00a0/g, ' ').replace(/\s*·\s*/g, ' · '));

describe('a day of the diary', () => {
  const today = NOW.toISODate()!;
  const seen: string[] = [];

  /** The card as the grow's own page hands it its reader: the sheet that corrects a line, the curve of a moment. */
  function Card({ one, live, cameras = true }: { one: GrowDiaryDay; live: boolean; cameras?: boolean }) {
    const correcting = useCorrecting();
    const reader: DiaryReader = {
      zone: null,
      readingNames: grow.measurements,
      picture: mediaUrl,
      curvesOf: () => null,
      cameras,
      byline: session.user.user?.isDemo !== true,
      correct: (line, dayNumber) => correcting(line, { label: grow.name, dayNumber, ...growStanding(grow) }),
      curveOf: (metric, moment) => `/timeline?space=space-1&focus=${metric}&at=${moment}`,
    };

    return (
      <DayCard day={one} reader={reader} people={people} today={today} now={NOW} live={live} onPicture={picture => seen.push(picture.mediaId)} />
    );
  }
  const drawDay = (one: GrowDiaryDay, live = false) => draw(<Card one={one} live={live} />);
  const linesOf = () => screen.getAllByRole('listitem').map(line => line.textContent?.replace(/\u00a0/g, ' ') ?? '');
  const note = (id: string, hour: number) =>
    entry({ id, kind: 'note', text: `Note ${id}`, authorId: 'user-1', occurredAt: at(1, hour), values: { kind: 'note' } });
  const out = (hour: number, minutes: number, above = true) => ({
    kind: 'excursion' as const,
    at: at(1, hour),
    endedAt: DateTime.fromISO(at(1, hour)).plus({ minutes }).toISO()!,
    metric: 'humidity' as const,
    above,
    extremeValue: 70,
  });

  beforeEach(() => {
    seen.length = 0;
  });

  it('says how the climate was and how much of the day stood inside its targets', () => {
    drawDay(day(1, { climate: { temperature: 25.34, humidity: 57.2, inBandFraction: 0.957 } }));

    expect(screen.getByRole('heading', { name: 'Yesterday · Day 34' })).toBeInTheDocument();
    expect(screen.getByText('Ø 25.3 °C · 57 %')).toBeInTheDocument();
    expect(screen.getByText('96 % of the time on target')).toBeInTheDocument();
  });

  it('says nothing of a share the server did not state, rather than a number', () => {
    drawDay(day(1, { climate: { temperature: 25, humidity: 57, inBandFraction: null } }));

    expect(screen.getByText('Ø 25.0 °C · 57 %')).toBeInTheDocument();
    expect(screen.queryByText(/on target/)).not.toBeInTheDocument();
  });

  it('draws no frame for a picture where the day has none', () => {
    const { container } = drawDay(day(1, { climate: { temperature: 25, humidity: 57, inBandFraction: 1 } }));

    expect(container.querySelector('img')).toBeNull();
  });

  it('marks only what a device did without a person: the lamp, not what somebody wrote nor the maintenance somebody switched', () => {
    drawDay(
      day(1, {
        events: [
          { kind: 'light', at: at(1, 6), on: true, still: false },
          { kind: 'maintenance', at: at(1, 7), endedAt: DateTime.fromISO(at(1, 7)).plus({ minutes: 2 }).toISO()! },
          { kind: 'light', at: at(1, 18), on: false, still: false },
        ],
        entries: [entry({ id: 'own', authorId: 'user-1', occurredAt: at(1, 8) })],
      }),
    );

    const lines = linesOf();
    expect(lines[0]).toMatch(/You watered/);
    expect(lines[0]).not.toMatch(/by itself/);
    // On and off are one line, and a person's.
    expect(lines[1]).toBe('07:00Maintenance · 2 min');
    // A day that is over says the hours the lamp burned in one line.
    expect(lines[2]).toMatch(/^06:00Light 06:00–18:00by itself$/);
    expect(lines).toHaveLength(3);
  });

  it('gives a lamp that has not gone off no end: on since then while it is known to burn, and only that it came on otherwise', () => {
    drawDay(day(0, { events: [{ kind: 'light', at: at(0, 6), on: true, still: true }] }), true);
    expect(linesOf()).toEqual(['06:00Light on since 06:00by itself']);
    cleanup();

    // A day that is over, or a device that fell silent: nobody says what the lamp did after it came on.
    drawDay(day(1, { events: [{ kind: 'light', at: at(1, 18), on: true, still: false }] }));
    expect(linesOf()).toEqual(['18:00Light on at 18:00by itself']);
  });

  it('does not take a lamp going off in the morning for the end of the evening it came on in', () => {
    drawDay(
      day(1, {
        events: [
          { kind: 'light', at: at(1, 0), on: false, still: false },
          { kind: 'light', at: at(1, 18), on: true, still: false },
        ],
      }),
    );

    expect(linesOf()).toEqual(['18:00Light off at 00:00 · on again at 18:00by itself']);
  });

  it('says when another device took over the measuring, by its name or else by its kind, as a line nobody wrote', () => {
    drawDay(day(1, { events: [{ kind: 'device', at: at(1, 23), name: 'Controller B', type: 'controller' }] }));
    expect(linesOf()).toEqual(['23:00Controller B measures from 23:00by itself']);
    cleanup();

    // A claim stores the type where nobody said a name, and a type is a key, not a word.
    drawDay(day(1, { events: [{ kind: 'device', at: at(1, 23), name: 'controller', type: 'controller' }] }));
    expect(linesOf()).toEqual(['23:00Controller measures from 23:00by itself']);
  });

  it('says a reading that left its targets as one line however often and on whichever side, and leads to the curve of that moment', () => {
    const { unmount } = drawDay(day(1, { events: [out(20, 22), out(22, 18)] }));

    const line = screen.getByRole('link', { name: reads(/Humidity too high 2× · 40 min in all/) });
    expect(line.getAttribute('href')).toMatch(/^\/timeline\?space=space-1&focus=humidity&at=/);
    // The sign that it leads somewhere is bound to its last word, and is not said.
    expect(line.textContent).toMatch(/all\u00a0›$/);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    unmount();

    drawDay(day(1, { events: [out(20, 22), out(22, 18, false)] }));
    expect(linesOf()).toEqual([expect.stringMatching(/Humidity off target 2× · 40 min in all/)]);
  });

  it('opens a line somebody wrote in the sheet it was written in', async () => {
    drawDay(day(1, { entries: [entry({ kind: 'training', authorId: 'user-1', text: 'Defoliated', values: { kind: 'training' } })] }));

    fireEvent.click(screen.getByRole('button', { name: /Defoliated/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens a photo´s line to be corrected like any other', async () => {
    drawDay(
      day(1, {
        entries: [entry({ id: 'photo', kind: 'photo', authorId: 'user-1', text: 'First flowers', mediaIds: ['photo-1'], values: { kind: 'photo' } })],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /First flowers/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Photo' });
    expect(within(sheet).getByRole('textbox')).toHaveValue('First flowers');
    expect(within(sheet).getByRole('button', { name: 'Take this line back' })).toBeInTheDocument();
  });

  it('says of a camera´s picture somebody made a line of that it was kept, not taken', () => {
    drawDay(
      day(1, {
        entries: [entry({ id: 'kept', kind: 'photo', authorId: 'user-1', cameraId: 'camera-1', mediaIds: ['still-1'], values: { kind: 'photo' } })],
      }),
    );

    expect(linesOf()[0]).toMatch(/You kept a camera picture/);
  });

  it('names an alarm by its rule, with the reading and the edge it crossed in words under it, and leaves it inert', () => {
    const alarm = entry({
      id: 'e3',
      kind: 'alarm',
      source: 'alarm',
      authorId: null,
      severity: 'warning',
      message: { key: 'message-alarm-triggered', params: ['Too warm (temperature), value=31.2, upper threshold=28, lower threshold=n/a'] },
      values: { kind: 'alarm' },
    });
    drawDay(day(1, { entries: [alarm] }));

    expect(linesOf()).toEqual([expect.stringMatching(/Alarm: Too warmTemperature above 28 °Cby itself$/)]);
    expect(screen.queryByRole('button', { name: /Too warm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Too warm/ })).not.toBeInTheDocument();
  });

  it('offers no way into a line on the demo, which reads the whole account and writes nothing to it', () => {
    session.user = ON_THE_DEMO;
    drawDay(day(1, { entries: [entry({ kind: 'training', text: 'Defoliated', values: { kind: 'training' } })] }));

    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Defoliated/ })).not.toBeInTheDocument();
  });

  it('never folds the grower´s own lines behind a device´s: six of their own, then the fold', () => {
    const own = [1, 2, 3, 4, 5, 6, 7, 8].map(n => note(`n${n}`, 6 + n));
    drawDay(day(1, { entries: own.reverse(), events: [{ kind: 'light', at: at(1, 6), on: true, still: false }, out(20, 22)] }));

    expect(linesOf().every(line => /Note n/.test(line))).toBe(true);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    // Two notes, the lamp and the humidity.
    fireEvent.click(screen.getByRole('button', { name: '+ 4 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('fills what is left of four lines with what the devices did, what is out of the ordinary before the lamp', () => {
    const lines = dayLines(
      i18next.t.bind(i18next) as never,
      i18next,
      day(1, {
        entries: [note('a', 9), note('b', 8)],
        events: [
          { kind: 'light', at: at(1, 6), on: true, still: false },
          { kind: 'light', at: at(1, 18), on: false, still: false },
          out(20, 22),
          { ...out(21, 5), metric: 'temperature' as const },
        ],
      }),
      null,
    );

    expect(lines).toHaveLength(5);
    // One line more than fits is shown rather than folded behind a button as tall as itself.
    expect(shownLines(lines)).toHaveLength(5);
    // With more behind the fold: two of their own, and two of the device lines - the readings outside their
    // targets before the lamp.
    const more = [...lines, { ...lines[0], key: 'outside-co2' }];
    expect(shownLines(more).map(line => line.key)).toEqual(['outside-temperature', 'outside-humidity', 'a', 'b']);
  });

  it('leads from today´s picture to the camera, and opens the picture of a day that is over', () => {
    const still = { mediaId: 'still-1', cameraId: 'camera-1', capturedAt: at(0, 9) };
    const { unmount } = drawDay(day(0, { still }), true);
    expect(screen.getByRole('link', { name: /Camera picture of day 35/ })).toHaveAttribute('href', '/cameras/camera-1');
    unmount();

    drawDay(day(1, { still: { ...still, capturedAt: at(1, 13) } }));
    fireEvent.click(screen.getByRole('button', { name: /Camera picture of day 34/ }));
    expect(seen).toEqual(['still-1']);
  });

  it('opens today´s picture too for a reader who has no way to the camera', () => {
    draw(<Card one={day(0, { still: { mediaId: 'still-1', cameraId: 'camera-1', capturedAt: at(0, 9) } })} live cameras={false} />);

    expect(screen.queryByRole('link', { name: /Camera picture/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Camera picture of day 35/ }));
    expect(seen).toEqual(['still-1']);
  });

  it('is headed by a photo written that day where no camera pictured it', () => {
    drawDay(day(1, { entries: [entry({ id: 'photo', kind: 'photo', mediaIds: ['photo-1'], values: { kind: 'photo' } })] }));

    expect(screen.getByRole('img', { name: 'Photo of day 34' })).toHaveAttribute('src', '/media/photo-1');
  });

  it('says an alarm that fired over and over in one line, so a reading hovering at its threshold does not bury the day', () => {
    const alarm = (id: string, minute: number, fired: boolean) =>
      entry({
        id,
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        severity: fired ? 'warning' : 'info',
        occurredAt: DateTime.fromISO(at(1, 2)).plus({ minutes: minute }).toISO()!,
        message: {
          key: fired ? 'message-alarm-triggered' : 'message-alarm-resolved',
          params: [`Too humid (humidity), value=${fired ? 60.4 : 59.7}, upper threshold=60, lower threshold=n/a`],
        },
        values: { kind: 'alarm' },
      });
    const storm = [5, 4, 3, 2, 1, 0].map(minute => alarm(`a${minute}`, minute, minute % 2 === 0));
    const once = [alarm('cleared', 30, false), alarm('fired', 20, true)].map(one => ({
      ...one,
      message: { ...one.message!, params: [one.message!.params[0].replace('Too humid', 'Too dry')] },
    }));
    drawDay(day(1, { entries: [...once, ...storm, entry({ id: 'own', authorId: 'user-1', occurredAt: at(1, 1) })] }));

    const lines = linesOf();
    // The rule that fired three times is one line; the one that fired once keeps the line that says it is over; the watering stays in sight.
    expect(lines).toHaveLength(4);
    expect(lines.filter(line => /Too humid/.test(line))).toEqual([expect.stringMatching(/Too humid · 3× since 17 Sep 02:00Humidity above 60 %/)]);
    expect(lines.filter(line => /Too dry/.test(line))).toEqual([
      expect.stringMatching(/Too dry · over/),
      expect.stringMatching(/Too dryHumidity above 60 %/),
    ]);
    expect(lines[3]).toMatch(/You watered/);
  });

  it('folds a run of the same machine line into one, as every summary does', () => {
    const step = (id: string, hour: number) =>
      entry({
        id,
        kind: 'plan',
        source: 'plan',
        authorId: null,
        occurredAt: at(1, hour),
        message: { key: 'message-recipe-advanced', params: ['2'] },
        values: { kind: 'plan', planId: 'plan-1', stepIndex: 1, transition: null },
      });

    expect(dayLines(i18next.t.bind(i18next) as never, i18next, day(1, { entries: [step('c', 9), step('b', 8), step('a', 7)] }), null)).toHaveLength(
      1,
    );
  });
});

describe('the diary', () => {
  const written = (id: string, back: number) => entry({ id, kind: 'note', text: `Note ${id}`, occurredAt: at(back, 9), values: { kind: 'note' } });
  const climate = { temperature: 25, humidity: 55, inBandFraction: 1 };
  const drawDiary = (of: GrowListItem = grow) => draw(<Diary grow={of} now={NOW} picturesTo="/grow/pictures" />);

  beforeEach(() => {
    wire.diary[''] = {
      // Days 35 to 29 are week 5, days 28 to 22 week 4.
      items: [
        diaryWeek(
          5,
          [0, 1, 2, 3, 4, 5, 6].map(back => day(back, { climate, entries: back === 4 ? [written('a', 4)] : [] })),
        ),
        diaryWeek(
          4,
          [7, 8, 9].map(back => day(back, { climate, still: { mediaId: `still-${back}`, cameraId: 'camera-1', capturedAt: at(back, 13) } })),
          {
            film: { mediaId: 'film-4', dayFrom: 22, dayTo: 28, lengthSeconds: 20 },
          },
        ),
      ],
      nextCursor: 'earlier',
      people,
    };
    wire.diary.earlier = { items: [diaryWeek(3, [day(14, { climate })])], nextCursor: null, people: [] };
  });

  it('opens the newest three days as cards and folds the days before them into their weeks', async () => {
    drawDiary();

    expect(await screen.findByRole('heading', { name: 'Today · Day 35' })).toBeInTheDocument();
    expect(screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual([
      'Today · Day 35',
      'Yesterday · Day 34',
      'Wednesday · Day 33',
    ]);
    // The rest of the week the cards began in, then the week before with what it holds.
    expect(screen.getByRole('button', { name: reads(/^Day 32 to 29 · Flower, week 2/) })).toHaveTextContent('1 entry');
    expect(screen.getByRole('button', { name: reads(/^Day 28 to 26 · Flower, week 1/) })).toHaveTextContent('3 pictures · Week film');
  });

  it('opens a week´s days where they stand, with its film', async () => {
    drawDiary();

    const row = await screen.findByRole('button', { name: reads(/^Day 28 to 26/) });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Fri 11 Sep · Day 28' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Week film · Flower, week 1/ })[0]).toHaveTextContent('Day 22 to 28 in 20 seconds');
  });

  it('is found as it was left by whoever comes back to it: the week opened stays open', async () => {
    const first = drawDiary();
    fireEvent.click(await screen.findByRole('button', { name: reads(/^Day 28 to 26/) }));
    first.unmount();

    // The same entry of the history, come back to.
    drawDiary();

    expect(await screen.findByRole('button', { name: reads(/^Day 28 to 26/) })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Fri 11 Sep · Day 28' })).toBeInTheDocument();
  });

  /** A link that names a day - the camera's "Im Tagebuch zeigen" - finds the diary open on it. */
  describe('opened on a day', () => {
    const into = vi.fn();
    const drawOn = (dayNumber: number) =>
      drawAt(
        <LogProvider>
          <Diary grow={grow} now={NOW} picturesTo="/grow/pictures" />
        </LogProvider>,
        { at: `/grows/grow-1?day=${dayNumber}` },
      );

    beforeEach(() => {
      into.mockClear();
      // jsdom draws nothing, so it has nothing to scroll.
      Element.prototype.scrollIntoView = into;
    });

    it('has the week that holds the day open and its card in view, and leaves the other weeks folded', async () => {
      drawOn(27);

      const card = await screen.findByRole('article', { name: 'Thu 10 Sep · Day 27' });
      expect(screen.getByRole('button', { name: reads(/^Day 28 to 26/) })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: reads(/^Day 32 to 29/) })).toHaveAttribute('aria-expanded', 'false');
      expect(into).toHaveBeenCalledTimes(1);
      expect(into.mock.contexts[0]).toBe(card);
    });

    it('reads the weeks before until they hold the day', async () => {
      drawOn(21);

      const card = await screen.findByRole('article', { name: 'Fri 4 Sep · Day 21' });
      expect(wire.asked.filter(call => call.includes('/diary'))).toEqual(['/grows/grow-1/diary', '/grows/grow-1/diary?cursor=earlier&limit=8']);
      expect(into.mock.contexts).toEqual([card]);
    });

    it('brings a day of the open cards into view without unfolding anything', async () => {
      drawOn(34);

      const card = await screen.findByRole('article', { name: 'Yesterday · Day 34' });
      expect(into.mock.contexts).toEqual([card]);
      expect(screen.getByRole('button', { name: reads(/^Day 28 to 26/) })).toHaveAttribute('aria-expanded', 'false');
    });

    it('is left where it was scrolled to for whoever comes back to it', async () => {
      const first = drawOn(27);
      await screen.findByRole('article', { name: 'Thu 10 Sep · Day 27' });
      first.unmount();

      // The same entry of the history, come back to.
      drawOn(27);

      expect(await screen.findByRole('article', { name: 'Thu 10 Sep · Day 27' })).toBeInTheDocument();
      expect(into).toHaveBeenCalledTimes(1);
    });
  });

  it('reads the weeks before only when asked for them, eight at a time', async () => {
    drawDiary();

    fireEvent.click(await screen.findByRole('button', { name: 'Earlier weeks' }));

    expect(await screen.findByRole('button', { name: reads(/^Day 21/) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Earlier weeks' })).not.toBeInTheDocument();
    expect(wire.asked.filter(call => call.includes('/diary'))).toEqual(['/grows/grow-1/diary', '/grows/grow-1/diary?cursor=earlier&limit=8']);
  });

  it('keeps today´s card where nothing happened yet, and leaves an empty day of the past out', async () => {
    wire.diary[''] = { items: [diaryWeek(5, [day(0), day(1), day(2, { entries: [written('b', 2)] })])], nextCursor: null, people };
    drawDiary();

    expect(await screen.findByText('Nothing written today yet')).toBeInTheDocument();
    expect(screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual(['Today · Day 35', 'Wednesday · Day 33']);
  });

  it('has no today for a grow that has ended: its days are dates', async () => {
    wire.diary[''] = { items: [diaryWeek(5, [day(0), day(1, { entries: [written('c', 1)] })])], nextCursor: null, people };
    drawDiary({ ...grow, endedAt: at(0, 9) });

    expect(await screen.findByRole('heading', { name: 'Thu 17 Sep · Day 34' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Today/ })).not.toBeInTheDocument();
  });

  it('keeps what was written for a moment before the grow began in sight, after the last day and without a day of its own', async () => {
    wire.diary[''] = {
      items: [diaryWeek(5, [day(0, { entries: [written('d', 0)] })])],
      nextCursor: null,
      people,
      earlier: [entry({ id: 'early', kind: 'note', authorId: 'user-1', text: 'Seeds arrived', occurredAt: at(40, 9), values: { kind: 'note' } })],
    };
    drawDiary();

    const before = await screen.findByRole('article', { name: 'Before the start' });
    expect(within(before).getByRole('button', { name: /Seeds arrived/ })).toBeInTheDocument();
    expect(within(before).getByRole('listitem')).toHaveTextContent(/^9 Aug 09:00/);
  });
});

describe('the pictures of a grow', () => {
  const still = (back: number) => ({ mediaId: `still-${back}`, cameraId: 'camera-1', capturedAt: at(back, 13) });
  const photo = entry({
    id: 'photo',
    kind: 'photo',
    authorId: 'user-1',
    occurredAt: at(1, 18),
    text: 'First flowers',
    mediaIds: ['photo-1'],
    values: { kind: 'photo' },
  });

  beforeEach(() => {
    wire.diary[''] = {
      items: [
        diaryWeek(5, [day(0, { still: still(0) }), day(1, { still: still(1), entries: [photo] })]),
        diaryWeek(4, [day(7, { still: still(7) })], { film: { mediaId: 'film-4', dayFrom: 22, dayTo: 28, lengthSeconds: 20 } }),
      ],
      nextCursor: null,
      people,
    };
  });

  const drawPictures = () => draw(<Pictures grow={grow} now={NOW} />);

  it('lists them week by week, the camera´s named by their day and a photo as one´s own, under the newest week film', async () => {
    drawPictures();

    expect(await screen.findByRole('heading', { name: 'This week · from day 29' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Flower, week 1 · Day 22 to 28' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(tile => tile.textContent)).toEqual(['Day 35', 'Your photo', 'Day 34', 'Day 28']);
    expect(screen.getByRole('button', { name: /^Week film · Flower, week 1/ })).toBeInTheDocument();
  });

  it('shows the photos alone or the camera alone', async () => {
    drawPictures();

    fireEvent.click(await screen.findByRole('button', { name: 'Your photos' }));
    expect(screen.getAllByRole('listitem').map(tile => tile.textContent)).toEqual(['Your photo']);

    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(screen.getAllByRole('listitem').map(tile => tile.textContent)).toEqual(['Day 35', 'Day 34', 'Day 28']);
  });

  it('keeps which pictures are shown in the address, so a reload and a link keep it', async () => {
    drawAt(
      <LogProvider>
        <Pictures grow={grow} now={NOW} />
      </LogProvider>,
      { at: '/grow/pictures?show=photos' },
    );

    expect(await screen.findByRole('button', { name: 'Your photos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Day 35' })).not.toBeInTheDocument();
  });

  it('offers the camera´s pictures as a choice only where a camera watched, and keeps a still somebody made a line of among them', async () => {
    const kept = entry({
      id: 'kept',
      kind: 'photo',
      authorId: 'user-1',
      cameraId: 'camera-1',
      occurredAt: at(2, 13),
      mediaIds: ['still-2'],
      values: { kind: 'photo' },
    });
    wire.diary[''] = { items: [diaryWeek(5, [day(1, { entries: [photo] }), day(2, { entries: [kept] })])], nextCursor: null, people };
    const { unmount } = drawPictures();

    fireEvent.click(await screen.findByRole('button', { name: 'Camera' }));
    expect(screen.getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(['/media/still-2']);
    unmount();

    // Nothing but photos off a phone, and no camera where the grow stands: nothing to choose.
    wire.diary[''] = { items: [diaryWeek(5, [day(1, { entries: [photo] })])], nextCursor: null, people };
    drawPictures();
    expect(await screen.findByRole('button', { name: 'Your photos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('does not say of weeks without a picture that the grow has none, while earlier weeks are still to be asked for', async () => {
    wire.diary[''] = { items: [diaryWeek(5, [day(0)])], nextCursor: 'earlier', people };
    drawPictures();

    expect(await screen.findByText('No pictures in these weeks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Earlier weeks' })).toBeInTheDocument();
  });

  it('makes a line of the diary out of the camera´s picture of a day', async () => {
    drawPictures();
    fireEvent.click(await screen.findByRole('button', { name: /Camera picture of day 34/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to the diary as an entry' }));

    await waitFor(() => expect(wire.writes).toHaveLength(1));
    expect(wire.writes[0]).toMatchObject({
      method: 'POST',
      path: '/entries',
      body: { kind: 'photo', growId: 'grow-1', cameraId: 'camera-1', mediaIds: ['still-1'], occurredAt: at(1, 13) },
    });
  });

  it('makes a picture the grow´s cover, and offers no line for a picture that already is one', async () => {
    drawPictures();
    fireEvent.click(await screen.findByRole('button', { name: /Photo of day 34/ }));
    const viewer = screen.getByRole('dialog');
    expect(within(viewer).queryByRole('button', { name: 'Add to the diary as an entry' })).not.toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Use as cover' }));

    await waitFor(() => expect(wire.writes).toEqual([{ method: 'PATCH', path: '/grows/grow-1', body: { coverMediaId: 'photo-1' } }]));
  });

  it('offers a session that may only look neither', async () => {
    session.user = ON_THE_DEMO;
    drawPictures();
    fireEvent.click(await screen.findByRole('button', { name: /Camera picture of day 34/ }));

    const viewer = screen.getByRole('dialog');
    expect(within(viewer).queryByRole('button', { name: /entry|cover/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Take a photo' })).not.toBeInTheDocument();
  });
});
