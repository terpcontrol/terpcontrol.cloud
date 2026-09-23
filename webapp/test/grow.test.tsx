import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, GrowWeekCard, Media, MediaRenderStatus } from '@fg2/shared-types/v1';
import { PhaseBar } from '@/screens/grow/PhaseBar';
import { Report } from '@/screens/grow/Report';
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
      <MemoryRouter>{node}</MemoryRouter>
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

const wire = { calls: [] as string[], job: EXPORT_ROW('queued') };

const jsonOf = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
    wire.calls.push(path);

    if (path === '/grows/grow-1/report') {
      return jsonOf({ dayCount: 35, totals: { entryCount: 4, waterCount: 1, feedCount: 2, photoCount: 1 }, harvest: null, phases: [], people: [] });
    }
    if (path === '/grows/grow-1/export') return jsonOf({ media: wire.job, queued: true }, 202);
    if (path === '/media/media-export') return jsonOf(wire.job);

    return jsonOf({ status: 404, code: 'not_found', title: 'not_found', detail: `No stub for ${path}`, errors: [] }, 404);
  }),
);

beforeEach(() => {
  wire.calls = [];
  wire.job = EXPORT_ROW('queued');
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

  it('offers the file itself once the job is ready, at the size it will cost', async () => {
    wire.job = EXPORT_ROW('ready');
    drawReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Export this grow' }));

    // A button rather than a link: the zip is served to a session, so the bytes
    // are fetched with the token and handed to a download the app makes itself.
    expect(await screen.findByRole('button', { name: /Download/ })).toHaveTextContent('12.0 MB');
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
      endedAt: at(0, 10),
      summary: { ...grow.summary, phaseDay: 10 },
    };

    const { container } = draw(<PhaseBar grow={flipped} now={NOW} />);

    // Day 1 begins with the veg phase and the flip falls inside day 24, so veg
    // is days 1 to 23 and flowering begins on day 24.
    expect(container).toHaveTextContent('Veg23 d');
    expect(container).toHaveTextContent('Flowerday 10');
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
    expect(screen.getByText('+ 2 more in the timeline')).toBeInTheDocument();
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
