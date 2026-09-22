import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, GrowSeries, TimelineTargets } from '@fg2/shared-types/v1';
import { Charts } from '@/screens/charts/Charts';
import { csvOf, stepPoints } from '@/charts/series';

const state = vi.hoisted(() => ({
  series: null as GrowSeries | null,
  posted: [] as { path: string; body: unknown }[],
  refuse: false,
}));

// Every read the screen makes goes through the one client, so the hooks under
// test are the real ones and what a tap sends is what this records.
vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@/api/problem');

  return {
    api: {
      get: (path: string) => {
        if (path.startsWith('/grows/grow-1/series')) return Promise.resolve(state.series);
        if (path === '/grows/grow-1') return Promise.resolve(grow);
        if (path === '/spaces') return Promise.resolve({ items: [{ id: 'space-1', name: 'Tent 1' }], nextCursor: null });
        if (path === '/devices') return Promise.resolve({ items: [{ id: 'device-1', settings: { vpdLeafOffsetDay: -2 } }], nextCursor: null });
        if (path === '/chart-views') return Promise.resolve({ items: [], nextCursor: null });
        return Promise.resolve({ items: [], nextCursor: null });
      },
      post: (path: string, body: unknown) => {
        state.posted.push({ path, body });
        if (state.refuse) {
          return Promise.reject(
            new ApiError({ status: 422, code: 'name_taken', title: 'Refused', detail: 'A view of yours is already called that.', errors: [] }),
          );
        }

        return Promise.resolve({ id: 'view-1', createdAt: NOW.toISO(), ownerId: 'user-1', name: 'kept', definition: body });
      },
      patch: () => Promise.resolve({}),
      delete: () => Promise.resolve(undefined),
    },
  };
});

// A chart is a canvas, which jsdom has not got; what it would draw is checked
// by the unit tests at the foot of this file.
vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { ON_THE_DEMO, SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/**
 * The Charts view is the one screen that draws whatever was asked for, so what
 * it must get right is the offer: a chip stands only for a line the account
 * really has, two units share a panel only where they belong together, and a
 * session that may only look is offered no way to save.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');
const FROM = NOW.minus({ hours: 24 });
const at = (hour: number) => FROM.plus({ hours: hour }).toISO()!;

const targets = (setpoint: number, low: number, high: number): TimelineTargets => ({
  startsAt: at(0),
  endsAt: at(24),
  phaseId: 'phase-1',
  stage: 'flowering',
  day: { setpoint, band: { low, high } },
  night: { setpoint: setpoint - 2, band: { low: low - 2, high: high - 2 } },
});

const grow: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  description: null,
  type: 'photoperiod',
  phases: [],
  placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: at(0), endedAt: null, plantIds: null }],
  scheme: null,
  measurements: [
    { key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true },
    { key: 'ec', name: 'EC', unit: '', perPlant: false, targetMin: 1.4, targetMax: 1.8, chart: true },
  ],
  visibility: 'private',
  slug: 'spring-run',
  coverMediaId: null,
  filmMediaId: null,
  startedAt: NOW.minus({ days: 34 }).toISO()!,
  endedAt: null,
  isDemo: false,
  createdAt: NOW.minus({ days: 34 }).toISO()!,
  updatedAt: at(24),
  summary: { dayNumber: 35, stage: 'flowering', preset: 'flower', phaseDay: 11, weekNumber: 5, isAuto: false, groups: [], locations: [] },
};

const series: GrowSeries = {
  growId: 'grow-1',
  range: '24h',
  startsAt: at(0),
  endsAt: at(24),
  stepSeconds: 300,
  originAt: NOW.minus({ days: 34 }).toISO()!,
  dayFrom: 35,
  dayTo: 35,
  deviceIds: ['device-1'],
  climate: [
    {
      metric: 'temperature',
      points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 24 + hour / 12 })),
      targets: [targets(25, 24, 26)],
    },
    { metric: 'humidity', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 60 - hour / 6 })), targets: [targets(58, 54, 62)] },
    { metric: 'vpd', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 1.1 + hour / 100 })), targets: [targets(1.2, 1, 1.4)] },
  ],
  outputs: [
    { output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(6), endsAt: at(18) }] },
    { output: 'dehumidifier', deviceId: 'device-1', spans: [{ startsAt: at(8), endsAt: at(9) }] },
    { output: 'heater', deviceId: 'device-1', spans: [{ startsAt: at(2), endsAt: at(3) }] },
  ],
  nights: [{ startsAt: at(0), endsAt: at(6) }],
  measurements: [{ key: 'height', points: [{ measuredAt: at(4), value: 54, plantId: 'plant-1', entryId: 'e1' }] }],
};

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/charts?grow=grow-1']}>
        <Charts />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  state.series = series;
  state.posted = [];
  state.refuse = false;
  session.demo = false;
});

describe('the Charts view', () => {
  it('offers only the lines the account has, and draws the board´s panels for the ones it opens on', async () => {
    draw();

    expect(await screen.findByRole('heading', { name: 'Charts' })).toBeInTheDocument();
    expect(await screen.findByText('Tent 1 · Spring run')).toBeInTheDocument();

    // The five range chips, with the window the answer covers beside them.
    for (const label of ['24 h', '7 d', 'Phase', 'Grow', 'Custom …']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.getByText('day 35')).toBeInTheDocument();

    // CO2 is not offered: no controller reported it. Nor is EC, which the grow
    // defines and nobody has yet measured. Three outputs, so the rest fold away.
    for (const label of ['Temp', 'RH', 'VPD', 'Height', 'Light', 'Dehum', '+ more']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'CO2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Heat' })).not.toBeInTheDocument();

    // Temperature and humidity belong together, so they are one panel of two
    // axes; VPD is its own, and says what the leaf was taken to be.
    expect(screen.getByText('Temp + RH')).toBeInTheDocument();
    expect(screen.getByText('· overlaid, two axes')).toBeInTheDocument();
    expect(screen.getByText('°C · %')).toBeInTheDocument();
    expect(screen.getAllByText('VPD')).toHaveLength(2);
    expect(screen.getByText('· band moves with the phase · leaf −2 °C')).toBeInTheDocument();
    expect(screen.getByText('kPa')).toBeInTheDocument();

    for (const label of ['Stacked', 'Overlay', 'Day-of-grow', 'Save view', 'CSV']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/The nerd's room/)).toHaveTextContent('Two units on one panel only when they belong together.');
  });

  it('adds a measurement as a panel of its own, said to be measured rather than sensed', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Height' }));

    // Once as the chip that turned it on, once as the panel it turned on.
    expect(screen.getAllByText('Height')).toHaveLength(2);
    expect(screen.getByText('· measured · per plant')).toBeInTheDocument();
    expect(screen.getByText('cm')).toBeInTheDocument();
  });

  it('saves the chart as it stands, sending the question and no readings', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flower nights' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.posted).toHaveLength(1));
    expect(state.posted[0]).toEqual({
      path: '/chart-views',
      body: {
        name: 'Flower nights',
        definition: {
          deviceIds: ['device-1'],
          growId: 'grow-1',
          metrics: ['temperature', 'humidity', 'vpd'],
          outputs: [],
          measurements: [],
          span: { kind: 'last', forSeconds: 86400 },
          layout: 'stacked',
          intervalSeconds: 300,
        },
      },
    });
  });

  it('says what the server said when a view is refused, and keeps the sheet open', async () => {
    state.refuse = true;
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flower nights' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A view of yours is already called that.');
    expect(screen.getByLabelText('Name')).toHaveValue('Flower nights');
  });

  it('lets the demo read every chart and offers it no way to keep one', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('Temp + RH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save view' })).not.toBeInTheDocument();
  });

  it('says there is nothing to draw rather than drawing empty panels', async () => {
    state.series = { ...series, climate: [], outputs: [], measurements: [], nights: [] };
    draw();

    expect(await screen.findByText('No measurements in this period — try a different range.')).toBeInTheDocument();
    expect(screen.queryByText('Temp + RH')).not.toBeInTheDocument();
  });
});

describe('what a plot is made of', () => {
  it('turns the spans an output ran for into the square wave they describe', () => {
    expect(stepPoints([{ from: 10, to: 20 }], 0, 30)).toEqual([
      [0, 0],
      [10, 0],
      [10, 1],
      [20, 1],
      [20, 0],
      [30, 0],
    ]);
  });

  it('writes a row per instant anything was measured at, leaving a cell empty rather than inventing one', () => {
    const csv = csvOf(
      [
        { label: 'Temp (°C)', points: [[FROM.toMillis(), 24]] },
        { label: 'Height (cm)', points: [[FROM.plus({ hours: 4 }).toMillis(), 54]] },
      ],
      FROM.toMillis(),
    );
    const rows = csv.split('\n');

    expect(rows[0]).toBe('"time","day","Temp (°C)","Height (cm)"');
    expect(rows[1].endsWith(',1,24,')).toBe(true);
    expect(rows[2].endsWith(',1,,54')).toBe(true);
  });
});
