import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { Overview } from '@/screens/space/Overview';
import { LaterRound } from '@/ui/LaterRound';
import { LogProvider } from '@/log/LogProvider';

// A picture's address needs the session's media token, and what a screen offers
// depends on who is looking, so both are answered here rather than reached for.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
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

  it('shows the latest lines with who wrote them and today’s stills with their hour', () => {
    draw(<Overview overview={overview} now={NOW} />);

    expect(screen.getByText('Defoliated lower fan leaves')).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(screen.getByText(clock(at(7200)))).toBeInTheDocument();
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

describe('a tab of a later round', () => {
  it('says which round rather than showing an empty screen', () => {
    draw(<LaterRound round={13} what="space.later.members" />);

    expect(screen.getByText('Arrives with round 13')).toBeInTheDocument();
    expect(screen.getByText(/Who can log and who can manage/)).toBeInTheDocument();
  });
});
