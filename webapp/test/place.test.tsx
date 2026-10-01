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
import { PlacePage } from '@/screens/place/PlacePage';
import { useFreshness } from '@/ui/freshness';
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
 * What the two reads behind a place's page answer, so that a failure can be given its
 * real shape - and so that the two halves can be made to disagree, which is
 * what a recovery looks like from inside the page.
 */
const read = vi.hoisted(() => ({
  error: null as unknown,
  overview: null as Record<string, unknown> | null,
  live: null as Record<string, unknown> | null,
}));

// A home that lists no place, so a place's own address draws its page rather than handing over to Start.
vi.mock('@/api/home', async importOriginal => ({
  ...(await importOriginal<object>()),
  useHome: () => ({ isPending: false, data: { spaces: [] }, refetch: () => {} }),
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
      stagesReached: ['vegetative', 'flowering'],
      preset: null,
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
        <MemoryRouter initialEntries={['/spaces/space-1']}>
          <LogProvider>
            <Routes>
              <Route path="/spaces/:spaceId" element={<PlacePage />} />
            </Routes>
          </LogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('says so, and offers the way home rather than a retry that can never work', () => {
    read.error = new ApiError({ status: 404, code: 'space_not_found', title: 'Not found', detail: 'There is no space with that id.', errors: [] });
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('This place cannot be opened.');
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
        <MemoryRouter initialEntries={['/spaces/space-1']}>
          <LogProvider>
            <Routes>
              <Route path="/spaces/:spaceId" element={<PlacePage />} />
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

/**
 * The line under the wordmark, which says how old what is on the screen is.
 *
 * A place's page says that once, in the pill beside its name - "live · 16 s",
 * or "offline seit 10:19" for a tent gone quiet - so it hands the line nothing:
 * "aktualisiert vor 16 s" beside "live · 16 s" was two clocks for one fact,
 * and a tent quiet for four days answering "updated 0 s ago" was a wrong one.
 */
describe('how old a place´s page says it is', () => {
  /** Stands where the shell's own freshness line does, and shows the instant it was handed. */
  function Reported() {
    return <p data-testid="freshness">{useFreshness() ?? 'nothing'}</p>;
  }

  const drawPage = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/spaces/space-1']}>
          <LogProvider>
            <Routes>
              <Route path="/spaces/:spaceId" element={<PlacePage />} />
            </Routes>
            <Reported />
          </LogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('leaves the line under the wordmark empty, because the pill already says how old the readings are', () => {
    read.overview = { data: overview, error: null, isPending: false, isError: false, dataUpdatedAt: Date.now(), refetch: () => {} };
    read.live = {
      data: { values: [{ metric: 'temperature', value: 25.4, measuredAt: at(5), state: 'live' }], setpoints: [] },
      isError: false,
      dataUpdatedAt: Date.now(),
    };
    drawPage();

    expect(screen.getByTestId('freshness')).toHaveTextContent('nothing');
  });
});

describe('a tab of a later round', () => {
  it('says which round rather than showing an empty screen', () => {
    draw(<LaterRound round={13} what="space.later.members" />);

    expect(screen.getByText('Arrives with round 13')).toBeInTheDocument();
    expect(screen.getByText(/Who can log and who can manage/)).toBeInTheDocument();
  });
});
