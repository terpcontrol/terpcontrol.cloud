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
import type { ChartViewSpan, GrowListItem, GrowSeries, TimelineTargets } from '@fg2/shared-types/v1';
import { chartViewCreate } from '@fg2/shared-types/v1-schemas/diary.js';
import { Charts } from '@/screens/charts/Charts';
import { cardsOf, csvForCards, offeredBy, type Offered } from '@/screens/charts/cards';
import { csvOf, niceScale, stepPoints } from '@/charts/series';

const state = vi.hoisted(() => ({
  series: null as GrowSeries | null,
  /** The grow the screen is opened on, so a test can harvest it and move it out of its tent. */
  grow: null as unknown,
  posted: [] as { path: string; body: unknown }[],
  refuse: false,
  views: [] as unknown[],
  /** Every read the screen made, so what it asked the server for can be asserted and not only what it drew. */
  asked: [] as { path: string; query: Record<string, unknown> | undefined }[],
  /** Set to have the next series read fail, which is how a chip is tapped against a server that cannot answer. */
  breaks: false,
}));

// Every read the screen makes goes through the one client, so the hooks under
// test are the real ones and what a tap sends is what this records.
vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@/api/problem');

  return {
    api: {
      get: (path: string, query?: Record<string, unknown>) => {
        state.asked.push({ path, query });
        if (path.startsWith('/grows/grow-1/series')) {
          return state.breaks
            ? Promise.reject(new ApiError({ status: 503, code: 'unavailable', title: 'Nope', detail: 'The store said no.', errors: [] }))
            : Promise.resolve(state.series);
        }
        if (path.startsWith('/grows/grow-2/series')) return Promise.resolve(earlier);
        if (path === '/grows/grow-1/plants') return Promise.resolve({ items: plants, nextCursor: null });
        if (path === '/grows/grow-1') return Promise.resolve(state.grow);
        if (path === '/grows') return Promise.resolve({ items: [state.grow, { ...grow, id: 'grow-2', name: 'Autumn run' }], nextCursor: null });
        if (path === '/spaces') return Promise.resolve({ items: [{ id: 'space-1', name: 'Tent 1' }], nextCursor: null });
        if (path === '/devices') {
          return Promise.resolve({ items: [{ id: 'device-1', settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0 } }], nextCursor: null });
        }
        if (path === '/chart-views') return Promise.resolve({ items: state.views, nextCursor: null });
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
  summary: {
    dayNumber: 35,
    stage: 'flowering',
    preset: 'flower',
    phaseDay: 11,
    stageWeek: 2,
    weekNumber: 5,
    isAuto: false,
    groups: [],
    locations: [],
  },
};

const plants = [
  { id: 'plant-1', growId: 'grow-1', strain: 'Amnesia', label: 'Amnesia 1', status: 'growing', harvest: null, createdAt: at(0) },
  { id: 'plant-2', growId: 'grow-1', strain: 'Amnesia', label: 'Amnesia 2', status: 'growing', harvest: null, createdAt: at(0) },
];

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
    { output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(6), endsAt: at(18) }], heardUntil: at(24) },
    { output: 'dehumidifier', deviceId: 'device-1', spans: [{ startsAt: at(8), endsAt: at(9) }], heardUntil: at(24) },
    { output: 'heater', deviceId: 'device-1', spans: [{ startsAt: at(2), endsAt: at(3) }], heardUntil: at(24) },
  ],
  nights: [{ startsAt: at(0), endsAt: at(6) }],
  measurements: [
    {
      key: 'height',
      points: [
        { measuredAt: at(4), value: 54, plantId: 'plant-1', entryId: 'e1' },
        { measuredAt: at(5), value: 61, plantId: 'plant-2', entryId: 'e2' },
      ],
    },
  ],
};

/**
 * A run of the same tent a hundred days earlier. Its instants are its own and
 * so is its day 1, which is the whole point: laid over this one it has to land
 * on the same day numbers and nowhere near the same dates.
 */
const before = (hour: number) => FROM.plus({ hours: hour }).minus({ days: 100 }).toISO()!;

const earlier: GrowSeries = {
  ...series,
  growId: 'grow-2',
  originAt: DateTime.fromISO(series.originAt).minus({ days: 100 }).toISO()!,
  startsAt: before(0),
  endsAt: before(24),
  climate: [
    { metric: 'temperature', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: before(hour), value: 20 + hour / 24 })), targets: [] },
    { metric: 'humidity', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: before(hour), value: 70 })), targets: [] },
    { metric: 'vpd', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: before(hour), value: 0.9 })), targets: [] },
  ],
  outputs: [],
  nights: [],
  measurements: [],
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
  state.grow = grow;
  state.posted = [];
  state.asked = [];
  state.refuse = false;
  state.breaks = false;
  state.views = [];
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
    // The chip, the card's own title and the line the pinned reading names.
    expect(screen.getAllByText('VPD')).toHaveLength(3);
    // Both halves, because the device holds a different leaf offset for each
    // and the band on this one card is worked out from both of them.
    expect(screen.getByText('· band moves with the phase · leaf −2 °C by day, 0 °C at night')).toBeInTheDocument();
    expect(screen.getByText('kPa')).toBeInTheDocument();

    for (const label of ['Stacked', 'Overlay', 'Day-of-grow', 'Save view', 'CSV']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/The nerd's room/)).toHaveTextContent('Two units on one panel only when they belong together.');
  });

  it('says what step the table it offers is written at, rather than promising a rate it cannot give', async () => {
    draw();

    // The CSV is the answer already on the screen, which is a mean per window
    // and not what the devices reported at: a grow-wide window is a few hundred
    // rows over hundreds of thousands of readings.
    expect(await screen.findByText(/CSV takes what is on the screen/)).toHaveTextContent('one row per 5 min');
    expect(screen.queryByText(/native rate/)).not.toBeInTheDocument();
  });

  it('states a step that is not a whole hour as the hour and a half it is', async () => {
    // What a season comes out at: the window divided by the number of panels,
    // which lands wherever it lands. Floored to a single unit this read "one
    // row per 1 h" over rows an hour and a half apart.
    state.series = { ...series, stepSeconds: 5344 };
    draw();

    expect(await screen.findByText(/CSV takes what is on the screen/)).toHaveTextContent('one row per 1 h 29 min');
  });

  it('says nothing about rows for a window that has none, and still offers the way on to the whole grow', async () => {
    // A window the grow has no readings in is answered with no devices and a
    // step of zero, which is the server saying there is no series - not a rate
    // of one row per nothing.
    state.series = { ...series, stepSeconds: 0, deviceIds: [], climate: [], outputs: [], measurements: [], nights: [] };
    draw();

    expect(await screen.findByText(/No measurements in this period/)).toBeInTheDocument();
    expect(screen.queryByText(/CSV takes what is on the screen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/one row per/)).not.toBeInTheDocument();
    expect(screen.getByText(/is under Export on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spring run' })).toHaveAttribute('href', '/grows/grow-1');
  });

  it('reads out every line at the cursor and prints both ends of every scale', async () => {
    draw();

    // The cursor rests at the end of the window until it is moved, so what is
    // pinned is the newest reading of each line, in its own unit.
    const reading = await screen.findByRole('status');
    expect(reading).toHaveTextContent('Temp 26 °C');
    expect(reading).toHaveTextContent('RH 56 %');
    expect(reading).toHaveTextContent('VPD 1.34 kPa');

    // And the panel itself carries its scales: temperature on the left, humidity on the right.
    const pair = screen.getByText('Temp + RH').closest('section')!;
    for (const figure of ['27', '21', '65', '50']) expect(pair).toHaveTextContent(figure);
  });

  it('prints a dash rather than the last figure it heard where the series stops before the window does', async () => {
    // The tent fell quiet half way through the window, which the answer says by
    // breaking every line after the last reading. The cursor rests at the right
    // edge, so this is the reading somebody opening the screen is shown.
    state.series = {
      ...series,
      climate: series.climate.map(panel => ({ ...panel, points: [...panel.points.slice(0, 3), { measuredAt: at(13), value: null }] })),
    };
    draw();

    const reading = await screen.findByRole('status');
    for (const line of ['Temp —', 'RH —', 'VPD —']) expect(reading).toHaveTextContent(line);
    expect(reading).not.toHaveTextContent('26 °C');
  });

  it('adds a measurement as a panel of its own, one line per plant rather than one across all of them', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Height' }));

    // Once as the chip that turned it on, once as the panel it turned on.
    expect(screen.getAllByText('Height')).toHaveLength(2);
    expect(screen.getByText('· measured · per plant')).toBeInTheDocument();
    expect(screen.getByText('cm')).toBeInTheDocument();

    // Two plants were measured, so the card carries two lines and says which is which.
    const reading = screen.getByRole('status');
    expect(reading).toHaveTextContent('Height · Amnesia 1 54 cm');
    expect(reading).toHaveTextContent('Height · Amnesia 2 61 cm');
  });

  it('works the VPD band out of the pair the tent is steered by when the answer carries none', async () => {
    state.series = { ...series, climate: series.climate.map(panel => (panel.metric === 'vpd' ? { ...panel, targets: [] } : panel)) };
    draw();

    expect(await screen.findByText('· band moves with the phase · leaf −2 °C by day, 0 °C at night')).toBeInTheDocument();
  });

  it('labels the two ends of a season with dates, and the two ends of a rolling day with weekdays', async () => {
    draw();
    await screen.findByText('Temp + RH');

    // A day begins and ends at the same minute, so the clock alone would label
    // both ends of the chart identically: the weekday is what tells them apart.
    for (const hour of [0, 24]) {
      expect(screen.getAllByText(DateTime.fromISO(at(hour)).toFormat('ccc HH:mm')).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['a season', '2026-01-19T13:39:00.000Z', '2026-08-24T15:31:00.000Z'],
    ['five days somebody picked', '2026-09-01T00:00:00.000Z', '2026-09-05T23:59:00.000Z'],
  ])('keeps the date on the axis of %s', async (_what, from, to) => {
    const opens = DateTime.fromISO(from);
    const closes = DateTime.fromISO(to);
    state.series = { ...series, startsAt: opens.toISO()!, endsAt: closes.toISO()! };
    draw();
    await screen.findByText('Temp + RH');

    // Seven months of chart used to be labelled "14:39" and "17:31", and five
    // days of September "00:00" and "23:59": widening from the clock stops as
    // soon as the two strings differ, which they do at once on any window that
    // does not begin and end at the same minute.
    expect(screen.getAllByText(opens.toFormat('d MMM HH:mm')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(closes.toFormat('d MMM HH:mm')).length).toBeGreaterThan(0);
  });

  it('keeps counting in days out of reach where no stretch of a grow is being drawn', async () => {
    draw();

    expect(await screen.findByRole('button', { name: 'Day-of-grow' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Grow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Day-of-grow' })).toBeEnabled());
  });

  it('offers a view saved over another run and says what this grow cannot draw of it', async () => {
    state.views = [
      {
        id: 'view-9',
        createdAt: NOW.toISO(),
        ownerId: 'user-1',
        name: 'Water in',
        definition: {
          deviceIds: [],
          growId: 'grow-9',
          metrics: ['temperature'],
          outputs: [],
          measurements: ['ec'],
          span: { kind: 'last', forSeconds: 86400 },
          layout: 'stacked',
          intervalSeconds: 300,
        },
      },
    ];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Water in' }));

    expect(screen.getByText('EC is not measured in this grow and is not drawn.')).toBeInTheDocument();
    // What it could draw is drawn: the view names temperature and nothing else.
    expect(screen.getByRole('button', { name: 'Temp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'RH' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lays an earlier run of the same tent over this one, each counted from its own day 1', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Grow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Day-of-grow' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Autumn run' }));

    // Its readings are a hundred days older and land on the same day of grow.
    const reading = await screen.findByRole('status');
    await waitFor(() => expect(reading).toHaveTextContent('Temp · Autumn run 21 °C'));
    expect(reading).toHaveTextContent('day 35');
  });

  it('offers the earlier runs of a tent a finished grow no longer stands in', async () => {
    // Harvested and moved out, which closes its placement. Asked only what
    // stands in the tent now, this grow knows of no tent at all and the row of
    // runs to compare with was never drawn - for exactly the grow the layout
    // exists for.
    state.grow = { ...grow, endedAt: at(24), placements: [{ ...grow.placements[0], endedAt: at(24) }] };
    state.series = { ...series, range: 'grow' };
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Grow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Day-of-grow' }));
    expect(await screen.findByRole('button', { name: 'Autumn run' })).toBeInTheDocument();

    // And the tent it stood in is still named beside the chart.
    expect(screen.getByText('Tent 1 · Spring run')).toBeInTheDocument();
    expect(state.asked.some(read => read.path === '/grows' && read.query?.including === 'ended')).toBe(true);
  });

  it('keeps the window already drawn when the next one cannot be read, dimmed rather than thrown away', async () => {
    draw();
    expect(await screen.findByText('Temp + RH')).toBeInTheDocument();

    state.breaks = true;
    fireEvent.click(screen.getByRole('button', { name: 'Phase' }));

    await waitFor(() => expect(screen.getByText('Temp + RH').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByText('Temp + RH')).toBeInTheDocument();
    expect(screen.queryByText('Could not load. Try again.')).not.toBeInTheDocument();
    // And what the chart is drawn from is still offered: a read that failed is
    // not the same claim as "nothing was ever measured here".
    expect(screen.getByRole('button', { name: 'VPD' })).toBeInTheDocument();
    expect(screen.queryByText('No measurements in this period — try a different range.')).not.toBeInTheDocument();
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

  it('keeps a window somebody picked by hand, spelled the one way the contract takes an instant', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Custom …' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-07' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'That week in March' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.posted).toHaveLength(1));
    // The server takes the whole body or none of it, and `instant()` - the one
    // scalar behind every ...At on the wire - reads a Z instant and nothing
    // else. Written with the reader's own offset, as Luxon writes one by
    // default, the two ends of the window were refused as "Invalid ISO
    // datetime" and the one window that cannot be asked for again by tapping a
    // chip was the one window that could not be kept.
    expect(chartViewCreate.safeParse(state.posted[0].body).success).toBe(true);

    const span = (state.posted[0].body as { definition: { span: ChartViewSpan } }).definition.span;
    expect(span.kind).toBe('fixed');
    const range = (span as { kind: 'fixed'; range: { startsAt: string; endsAt: string } }).range;
    expect(range.startsAt).toMatch(/Z$/);
    expect(range.endsAt).toMatch(/Z$/);

    // And it is the same moment as before: the two days a grower picked, whole,
    // in their own zone.
    expect(DateTime.fromISO(range.startsAt).toISODate()).toBe('2026-03-01');
    expect(DateTime.fromISO(range.startsAt).toFormat('HH:mm')).toBe('00:00');
    expect(DateTime.fromISO(range.endsAt).toISODate()).toBe('2026-03-07');
    expect(DateTime.fromISO(range.endsAt).toFormat('HH:mm')).toBe('23:59');
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

  it('ends the wave where the device was last heard rather than lying flat along the bottom to the edge', () => {
    // Off at 20, quiet from 25: the bottom between them is a claim about
    // hardware nobody has heard from, so the wave stops and breaks instead.
    expect(stepPoints([{ from: 10, to: 20 }], 0, 30, 25)).toEqual([
      [0, 0],
      [10, 0],
      [10, 1],
      [20, 1],
      [20, 0],
      [25, 0],
      [26, null],
    ]);
  });

  it('draws a device still reporting all the way to the edge', () => {
    expect(stepPoints([{ from: 10, to: 20 }], 0, 30, 30)).toEqual([
      [0, 0],
      [10, 0],
      [10, 1],
      [20, 1],
      [20, 0],
      [30, 0],
    ]);
  });

  it('cuts a pooled wave where the last of its controllers was heard, not the first', () => {
    const lanes: GrowSeries['outputs'] = [
      { output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(2), endsAt: at(4) }], heardUntil: at(6) },
      { output: 'light', deviceId: 'device-2', spans: [{ startsAt: at(8), endsAt: at(18) }], heardUntil: at(24) },
    ];
    const both = { ...series, outputs: lanes };
    const [card] = cardsOf(key => key, both, {
      picked: { metrics: [], outputs: ['light'], measurements: [] },
      layout: 'stacked',
      offered: offeredBy(both, []),
      leaf: null,
      plants: [],
    });

    // One controller went quiet at six and the other is still reporting: the
    // tent's lamp is still known about, so the wave runs to the window's end.
    const last = card.plot.lines[0].points[card.plot.lines[0].points.length - 1];
    expect(last).toEqual([DateTime.fromISO(at(24)).toMillis(), 0]);
  });

  it('pools two controllers into one wave that only ever steps forwards, and says it pooled them', () => {
    const lanes: GrowSeries['outputs'] = [
      { output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(10), endsAt: at(18) }], heardUntil: at(24) },
      { output: 'light', deviceId: 'device-2', spans: [{ startsAt: at(9), endsAt: at(19) }], heardUntil: at(24) },
    ];
    const both = { ...series, outputs: lanes };
    const offered: Offered = offeredBy(both, []);
    const [card] = cardsOf(key => key, both, {
      picked: { metrics: [], outputs: ['light'], measurements: [] },
      layout: 'stacked',
      offered,
      leaf: null,
      plants: [],
    });

    expect(card.about).toBe('charts.about.outputPooled');
    const times = card.plot.lines[0].points.map(([time]) => time);
    expect(times).toEqual([...times].sort((one, other) => one - other));
    // A switch has no scale worth printing: it ran or it did not.
    expect(card.scaleEnds).toEqual([null]);
  });

  it('gives a concentration no room below zero, and a fridge the cold half it really ran in', () => {
    // Seriotica's CO2 ran 366 to 6132 ppm against a band of 1000-1400, which
    // rounded outwards to a step of 2000 and a floor of -2000: a fifth of the
    // card was a concentration nothing can be in, and the curve was squeezed
    // into what was left of it.
    expect(niceScale([366, 6132, 1000, 1400])).toEqual({ low: 0, high: 8000 });

    // Nothing handed in is below zero in the first, and something is in the
    // second - which is the whole of the rule.
    expect(niceScale([20, 24])).toEqual({ low: 19, high: 25 });
    expect(niceScale([-4, 2])).toEqual({ low: -6, high: 4 });

    // And a sensor answering zero on every sample still gets a scale to lie
    // in rather than a line along its own edge.
    expect(niceScale([0, 0, 0])).toEqual({ low: 0, high: 0.05 });
  });

  it('writes both corners of every one-decimal window as the figures they mean', () => {
    // Every corner is a whole number of steps, and a step is 1, 2, 5 or 10 of
    // some power of ten - so every corner is a figure with few enough decimals
    // to be written out exactly. The multiplication that reaches it is not:
    // 169 × 0.2 comes to 33.800000000000004, and a corner one unit in the last
    // place above the round number ECharts re-derives is what threw the chart,
    // and with it the application, out of a screen.
    let checked = 0;
    for (let low = 0; low <= 100; low += 0.1) {
      for (let width = 0.1; width <= 5; width += 0.1) {
        const high = low + width;
        const scale = niceScale([Math.round(low * 10) / 10, Math.round(high * 10) / 10]);

        expect(scale.low).toBe(Number(scale.low.toPrecision(12)));
        expect(scale.high).toBe(Number(scale.high.toPrecision(12)));
        // And the air around the data is still there: a corner is snapped to
        // the figure it means, never inwards past what it has to hold.
        expect(scale.low).toBeLessThanOrEqual(Math.round(low * 10) / 10);
        expect(scale.high).toBeGreaterThanOrEqual(Math.round(high * 10) / 10);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(50_000);
  });

  it('counts a reading taken before day 1 as day 1, the way the grow´s own counter does', () => {
    const csv = csvOf([{ label: 'Temp (°C)', points: [[FROM.minus({ days: 3 }).toMillis(), 24]] }], FROM.toMillis());

    expect(csv.split('\n')[1]).toContain(',1,24');
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

  it('carries an output´s state across the rows between its switchings, and keeps every switching a row of its own', () => {
    // A lamp switches when the tent switched it and not on the step the
    // climate is bucketed at, so this one comes on and goes off half an hour
    // off the grid the readings sit on.
    const switching: GrowSeries = {
      ...series,
      outputs: [{ output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(6.5), endsAt: at(17.5) }], heardUntil: at(24) }],
    };
    const csv = csvForCards(key => key, switching, {
      picked: { metrics: ['temperature'], outputs: ['light'], measurements: [] },
      layout: 'stacked',
      offered: offeredBy(switching, []),
      leaf: null,
      plants: [],
    });
    const rows = csv.split('\n').slice(1);
    const cells = rows.map(row => row.split(','));

    // The lamp's own instants are still rows of their own - it came on at 06:30
    // and went off at 17:30, and the export is the record of that.
    expect(rows.length).toBeGreaterThan(series.climate[0].points.length);
    expect(cells.filter(([, , , light]) => light === '1')).not.toHaveLength(0);

    // And every row that carries a temperature now carries the lamp beside it,
    // which is the whole point of a table: the file used to hold the two in
    // one row out of seven thousand.
    const measured = cells.filter(([, , temperature]) => temperature !== '');
    expect(measured).toHaveLength(series.climate[0].points.length);
    expect(measured.every(([, , , light]) => light === '0' || light === '1')).toBe(true);
  });
});
