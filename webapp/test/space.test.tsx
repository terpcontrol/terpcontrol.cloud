import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, SpaceOverview } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import { Overview } from '@/screens/space/Overview';
import { SpacePage } from '@/screens/space/SpacePage';
import { LaterRound } from '@/ui/LaterRound';
import { LogProvider } from '@/log/LogProvider';

// A picture's address needs the session's media token, and what a screen offers
// depends on who is looking, so both are answered here rather than reached for.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * The zone the account is kept in, which is the zone every hour on this page
 * is drawn in. Nothing by default - an account still on its way - which leaves
 * the page on the browser's and is what the expectations below are written for.
 */
const account = vi.hoisted(() => ({ zone: null as string | null }));

vi.mock('@/api/account', async importOriginal => ({
  ...(await importOriginal<object>()),
  useMe: () => ({ data: account.zone === null ? undefined : { preferences: { timezone: account.zone } } }),
}));

beforeEach(() => {
  account.zone = null;
  read.overview = null;
  read.live = null;
});

/** What the reader may do in Tent 1, which is the other half of "what does this screen offer". */
const may = vi.hoisted(() => ({ youMay: 'own' as AccessNeed }));

/**
 * What the tent page's own two reads answer, so that a failure can be given its
 * real shape - and so that the two halves can be made to disagree, which is
 * what a recovery looks like from inside the page.
 */
const read = vi.hoisted(() => ({
  error: null as unknown,
  overview: null as Record<string, unknown> | null,
  live: null as Record<string, unknown> | null,
}));

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    useSpaces: () => spacesAnswering(spaceWhere(may.youMay)),
    useSpaceOverview: () =>
      read.overview ?? { data: undefined, error: read.error, isPending: false, isError: true, dataUpdatedAt: 0, refetch: () => {} },
    useSpaceLive: () => read.live ?? { data: undefined, isError: false, dataUpdatedAt: 0 },
  };
});

/**
 * The tent's overview is one answer drawn as it came: values with their
 * targets and ages, what is due with a Done that says what it writes, what
 * grows here, today's stills, the day's verdict in the board's words, and the
 * latest lines.
 */

const NOW = DateTime.fromISO('2026-09-18T12:00:00.000Z');
const at = (secondsAgo: number) => NOW.minus({ seconds: secondsAgo }).toISO()!;

/** Hours are drawn in the reader's zone, so the expectation is formed the same way. */
const clock = (iso: string) => DateTime.fromISO(iso).toFormat('HH:mm');

const overview: SpaceOverview = {
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  roomId: null,
  deviceIds: ['device-1'],
  values: [
    { metric: 'temperature', value: 25.1, measuredAt: at(20), state: 'live' },
    { metric: 'humidity', value: 57, measuredAt: at(20), state: 'live' },
    { metric: 'vpd', value: 1.32, measuredAt: at(20), state: 'live' },
    { metric: 'co2', value: 980, measuredAt: at(3 * 3600), state: 'offline' },
  ],
  setpoints: [
    { metric: 'temperature', value: 25, band: 1 },
    { metric: 'humidity', value: 50, band: 5 },
  ],
  targets: {
    day: [
      { metric: 'temperature', value: 25, band: 1 },
      { metric: 'humidity', value: 50, band: 5 },
    ],
    night: [
      { metric: 'temperature', value: 20, band: 1 },
      { metric: 'humidity', value: 50, band: 5 },
    ],
  },
  verdict: {
    deviceId: 'device-1',
    startsAt: at(86_400),
    endsAt: at(0),
    forSeconds: 86_400,
    stepSeconds: 120,
    rating: 'watch',
    inBandFraction: 0.91,
    metrics: [
      {
        metric: 'humidity',
        rating: 'watch',
        minValue: 48,
        maxValue: 61,
        averageValue: 53,
        dayBand: { low: 45, high: 55 },
        nightBand: { low: 45, high: 55 },
        inBandSeconds: 70_000,
        outOfBandSeconds: 12_000,
        excursions: [{ startedAt: '2026-09-18T02:10:00.000Z', endedAt: '2026-09-18T05:30:00.000Z', above: true, extremeValue: 61 }],
      },
    ],
    actuators: [
      { output: 'dehumidifier', runCount: 14, forSeconds: 8000 },
      { output: 'light', runCount: 1, forSeconds: 43_200 },
    ],
    trend: { metric: 'temperature', stepSeconds: 1800, endsAt: at(0), points: [24.5, 25, 25.2, 24.9] },
  },
  grows: [
    {
      growId: 'grow-1',
      name: 'Spring run',
      type: 'photoperiod',
      dayNumber: 34,
      phaseDay: 12,
      stageWeek: 2,
      weekNumber: 5,
      stage: 'flowering',
      preset: 'flower',
      isAuto: true,
      plantCount: 3,
      strains: ['Amnesia', 'Gelato'],
      coverMediaId: null,
      stageGroups: [],
      placedAt: at(12 * 86_400),
      placedOnDay: 22,
    },
  ],
  cameras: [{ cameraId: 'cam-1', name: 'Cam 1', lastStillAt: at(20), stills: [{ mediaId: 'media-1', capturedAt: at(7200) }] }],
  entries: [
    {
      id: 'e1',
      createdAt: at(3600),
      kind: 'training',
      occurredAt: at(3600),
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
      text: 'Defoliated lower fan leaves',
      message: null,
      values: { kind: 'training' },
      mediaIds: [],
      undoUntil: null,
    },
  ],
  dueTasks: [
    {
      id: 'reminder-1:2026-09-18',
      kind: 'water',
      label: 'Water',
      dueAt: at(0),
      subject: { type: 'grow', id: 'grow-1' },
      assigneeId: null,
      defaults: { kind: 'water', readings: [{ key: 'water_l', value: 2, plantId: null }] },
    },
  ],
  openAlerts: [],
  readingNames: [{ growId: 'grow-1', readings: [{ key: 'water_l', name: 'Water', unit: 'l' }] }],
  people: [{ id: 'user-anna', handle: 'anna' }],
};

// Every card can log: the sheet and the toast live above the screens, so a
// screen drawn on its own is drawn inside them.
const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
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

describe('the tent overview', () => {
  it('draws each value with its target and its age, dimmed and never hidden', () => {
    draw(<Overview overview={overview} now={NOW} />);

    const temperature = screen.getByText('25.1').closest('[data-age]')!;
    expect(temperature).toHaveAttribute('data-age', 'live');
    expect(temperature).toHaveTextContent('→ 25');
    expect(temperature).toHaveTextContent('in band');

    // Judged by the band the server put on the setpoint, not by a width of the client's own.
    expect(screen.getByText('57').closest('[data-age]')).toHaveTextContent('+7 high');
    expect(screen.getByText('1.32').closest('[data-age]')).toHaveTextContent('no target');
    expect(screen.getByText('980').closest('[data-age]')).toHaveAttribute('data-age', 'offline');

    expect(screen.getByText(/Flower preset · day 25 \/ 50 · night 20 \/ 50/)).toBeInTheDocument();
  });

  it('says what Done will write, and what grows here since when', () => {
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.getByText(/Done writes Watered · Spring run/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    const grow = screen.getByRole('link', { name: /Spring run/ });
    expect(grow).toHaveAttribute('href', '/grows/grow-1');
    expect(grow).toHaveTextContent('Day 34');
    expect(grow).toHaveTextContent('Flower · wk 2');
    expect(grow).toHaveTextContent('auto');
    expect(grow).toHaveTextContent('here since day 22');
  });

  it("tells the day in the board's words", () => {
    draw(<Overview overview={overview} now={NOW} />);

    const excursion = `${clock('2026-09-18T02:10:00.000Z')}–${clock('2026-09-18T05:30:00.000Z')}`;
    expect(screen.getByText(`91 % in band · 1 humidity excursion ${excursion} · dehumidifier ran 14×`)).toBeInTheDocument();
  });

  /**
   * A fridge has three fans and each is its own piece of hardware. Drawn with
   * two of them called "fan" the sentence carried two clauses a grower cannot
   * tell apart, while the Timeline of the same tent names all three.
   */
  it('names a fridge’s three fans apart', () => {
    const fans: SpaceOverview = {
      ...overview,
      verdict: {
        ...overview.verdict,
        actuators: [
          { output: 'fanInternal', runCount: 4, forSeconds: 900 },
          { output: 'fanExternal', runCount: 2, forSeconds: 600 },
          { output: 'fanBackwall', runCount: 1, forSeconds: 300 },
        ],
      },
    };
    draw(<Overview overview={fans} now={NOW} />);

    expect(screen.getByText(/fan ran 4× · exhaust ran 2× · back fan ran 1×$/)).toBeInTheDocument();
  });

  /**
   * The share is worked out over the windows that held a reading, so a tent
   * back from an outage an hour ago answers one over that hour under a heading
   * that says 24 h. Both metrics are aggregated over the same windows: added
   * together they would call this one span 48 minutes long.
   */
  it('names the span a partly measured day was judged over, and leaves such a day uncoloured', () => {
    const measured = { inBandSeconds: 960, outOfBandSeconds: 480, excursions: [] };
    const humidity = overview.verdict.metrics[0];
    const patchy: SpaceOverview = {
      ...overview,
      verdict: {
        ...overview.verdict,
        rating: 'poor',
        inBandFraction: 0.67,
        metrics: [
          { ...humidity, ...measured },
          { ...humidity, metric: 'temperature', ...measured },
        ],
        actuators: [],
      },
    };
    draw(<Overview overview={patchy} now={NOW} />);

    const sentence = screen.getByText('67 % in band over the 24 min that were measured');
    expect(sentence.closest('[data-rating]')).toBeNull();
  });

  it('shows the latest lines with who wrote them and today’s stills with their hour', () => {
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.getByText('Defoliated lower fan leaves')).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(screen.getByText(clock(at(7200)))).toBeInTheDocument();
  });

  it('draws a still´s hour and an excursion´s hours where the account is kept, not where the browser is', () => {
    // The camera's own page reads these pictures in the account's zone, and
    // this strip links straight to it, so the same still was labelled two
    // hours apart on two screens one tap from each other.
    account.zone = 'Asia/Tokyo';
    const there = (iso: string) => DateTime.fromISO(iso).setZone('Asia/Tokyo').toFormat('HH:mm');
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.getByText(there(at(7200)))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `Cam 1 at ${there(at(7200))}` })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${there('2026-09-18T02:10:00.000Z')}–${there('2026-09-18T05:30:00.000Z')}`))).toBeInTheDocument();
  });

  it('heads the verdict with the window it was actually computed over, however quiet the tent has been', () => {
    // The server always grades the 24 h ending now. A heading that named the
    // hour the last reading came in put a window over a panel that had been
    // computed for another one - and said a day full of readings ended on
    // Saturday while the panel under it said nothing had been heard at all.
    const quiet: SpaceOverview = {
      ...overview,
      values: overview.values.map(value => ({ ...value, measuredAt: at(4 * 86_400), state: 'offline' as const })),
      verdict: { ...overview.verdict, rating: null, inBandFraction: null, metrics: [], actuators: [] },
    };
    draw(<Overview overview={quiet} now={NOW} />);

    expect(screen.getByText('Climate · 24 h')).toBeInTheDocument();
    expect(screen.queryByText(/24 h to/)).not.toBeInTheDocument();
  });

  /**
   * The strip is the last eight lines whatever their age and the link opens the
   * Timeline on a fixed 24 hours, so on a quiet tent "All" landed on a window
   * holding two of the eight lines it was pressed from. The link names the
   * screen it opens, the way the same link three sections above already does.
   */
  it('names the screen the latest strip opens rather than promising the whole record', () => {
    draw(<Overview overview={overview} now={NOW} />);

    const ways = screen.getAllByRole('link', { name: 'Timeline' });
    expect(ways.length).toBeGreaterThanOrEqual(2);
    expect(ways.every(way => way.getAttribute('href') === `/spaces/${overview.spaceId}/timeline`)).toBe(true);
    expect(screen.queryByRole('link', { name: 'All' })).not.toBeInTheDocument();
  });

  it('says there is nothing to judge where nothing is steered', () => {
    const unsteered: SpaceOverview = {
      ...overview,
      targets: null,
      verdict: { ...overview.verdict, rating: null, inBandFraction: null, metrics: [], actuators: [] },
    };
    draw(<Overview overview={unsteered} now={NOW} />);

    expect(screen.getByText(/nothing to judge/)).toBeInTheDocument();
  });
});

/**
 * The same tent, read by its owner and by somebody let into it to write in its
 * diary. What a control is for decides which of the two gets it: putting the
 * tent on a stage writes the climate to the controller and moving a grow in
 * writes a placement, and both are `manage`.
 */
describe('what the tent offers, by who is reading', () => {
  it('offers the owner the climate preset and both ways to put a grow here', () => {
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.getByRole('button', { name: 'Climate preset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Grow' })).toBeInTheDocument();
  });

  it('offers a member none of them, and says once what they may do instead', () => {
    may.youMay = 'log';
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.queryByRole('button', { name: 'Climate preset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move here' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ Grow' })).not.toBeInTheDocument();
    expect(screen.getByText(/You may log here: entries, tasks and photos\./)).toBeInTheDocument();
    // What they were let in for is still theirs.
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    may.youMay = 'own';
  });
});

/**
 * Being taken out of somebody's tent while standing in it.
 *
 * The server is unambiguous - every read of that space answers 404 from the
 * moment the membership goes - and the difference between that and a dropped
 * connection is the difference between a retry that can work and one that never
 * can. The page says which of the two it is, and offers the way out rather than
 * a button that only fails.
 */
describe('a tent that is no longer shared with the reader', () => {
  const drawPage = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/spaces/space-1/overview']}>
          <LogProvider>
            <Routes>
              <Route path="/spaces/:spaceId/:tab" element={<SpacePage />} />
            </Routes>
          </LogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('says so, and offers the way home rather than a retry that can never work', () => {
    read.error = new ApiError({ status: 404, code: 'space_not_found', title: 'Not found', detail: 'There is no space with that id.', errors: [] });
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('This tent is not shared with you.');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('does not turn a server that never answered into somebody taking the tent away', () => {
    read.error = new Error('network down');
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load. Try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/**
 * A refresh that failed, while the page goes on showing what it knew.
 *
 * The two reads come round at different rates, so for up to a minute after the
 * network is back one of them has succeeded and the other has not.
 */
describe('the banner over a page that could not refresh', () => {
  const drawPage = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/spaces/space-1/overview']}>
          <LogProvider>
            <Routes>
              <Route path="/spaces/:spaceId/:tab" element={<SpacePage />} />
            </Routes>
          </LogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('dates itself by the half that failed, not by the half that has already come back', () => {
    // The live read is on half the overview's interval, so it recovers first.
    // Dated by the freshest of the two, the line read "could not refresh ·
    // showing what was known 0 s ago", which says both things at once.
    read.overview = { data: overview, error: null, isPending: false, isError: true, dataUpdatedAt: Date.now() - 120_000, refetch: () => {} };
    read.live = { data: undefined, isError: false, dataUpdatedAt: Date.now() };
    drawPage();

    expect(screen.getByText('Could not refresh · showing what was known 2 min ago')).toBeInTheDocument();
  });

  it('says nothing at all once every half has answered again', () => {
    read.overview = { data: overview, error: null, isPending: false, isError: false, dataUpdatedAt: Date.now(), refetch: () => {} };
    read.live = { data: undefined, isError: false, dataUpdatedAt: Date.now() };
    drawPage();

    expect(screen.queryByText(/Could not refresh/)).not.toBeInTheDocument();
  });
});

describe('a tab of a later round', () => {
  it('says which round rather than showing an empty screen', () => {
    draw(<LaterRound round={13} what="space.later.members" />);

    expect(screen.getByText('Arrives with round 13')).toBeInTheDocument();
    expect(screen.getByText(/Who can log and who can manage/)).toBeInTheDocument();
  });
});
