import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, MeasurementDefinition, Plant } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { LogProvider } from '@/log/LogProvider';
import { MeasureSheet } from '@/screens/grow/measurements/MeasureSheet';
import { Measurements } from '@/screens/grow/measurements/Measurements';

/**
 * What a grow measures, and taking a reading.
 *
 * Both are about the three rules a definition lives under, because every
 * reading ever written points at its key: the list is sent whole, a key is a
 * key once, and what has been measured settles the scope and keeps the row.
 * Every request is the app's own client, mocked at that one seam, so what is
 * asserted is what would go on the wire.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const height: MeasurementDefinition = { key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true };
const ec: MeasurementDefinition = {
  key: 'ec_input',
  name: 'EC · input',
  unit: 'mS/cm',
  perPlant: false,
  targetMin: 1.4,
  targetMax: 1.8,
  chart: true,
};
const runoff: MeasurementDefinition = {
  key: 'runoff_ec',
  name: 'Runoff EC',
  unit: 'mS/cm',
  perPlant: false,
  targetMin: null,
  targetMax: null,
  chart: false,
};

const grow = (measurements: MeasurementDefinition[]): GrowListItem =>
  ({
    id: 'grow-1',
    name: 'Spring run',
    measurements,
    summary: { dayNumber: 35, stage: 'flowering', groups: [], locations: [] },
  }) as unknown as GrowListItem;

const plant = (id: string, label: string): Plant =>
  ({ id, growId: 'grow-1', strain: 'Amnesia', label, status: 'active', harvest: null, createdAt: at(35) }) as Plant;

const plants = [plant('plant-1', 'Amnesia 1'), plant('plant-2', 'Amnesia 2')];

/** Height has been measured on both plants; the EC of the input never has been. */
const series = {
  growId: 'grow-1',
  range: 'grow',
  startsAt: at(35),
  endsAt: at(0),
  stepSeconds: 0,
  originAt: at(35),
  dayFrom: 1,
  dayTo: 35,
  deviceIds: [],
  climate: [],
  outputs: [],
  nights: [],
  measurements: [
    {
      key: 'height',
      points: [
        { measuredAt: at(6), value: 52, plantId: 'plant-1', entryId: 'e-1' },
        { measuredAt: at(3), value: 58, plantId: 'plant-1', entryId: 'e-2' },
        { measuredAt: at(3), value: 54, plantId: 'plant-2', entryId: 'e-3' },
      ],
    },
  ],
};

const measured: Entry = {
  id: 'e-2',
  createdAt: at(3),
  kind: 'measurement',
  occurredAt: at(3),
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
  values: {
    kind: 'measurement',
    readings: [
      { key: 'height', value: 58, plantId: 'plant-1' },
      { key: 'height', value: 54, plantId: 'plant-2' },
      { key: 'ec_input', value: 1.6, plantId: null },
    ],
  },
  mediaIds: [],
  undoUntil: null,
};

const state = { measurements: [height, ec, runoff] as MeasurementDefinition[] };

const answers = (path: string) => {
  if (path.startsWith('/grows/grow-1/series')) return series;
  if (path === '/grows/grow-1/plants') return { items: plants, nextCursor: null };
  if (path === '/grows/grow-1') return grow(state.measurements);
  if (path === '/entries') return { items: [measured], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

const target = { key: 'grow:grow-1', label: 'Spring run', growId: 'grow-1', spaceId: null, plantIds: [], dayNumber: 35, standsIn: 'space-1' };

const draw = (node: React.ReactNode, path = '/grows/grow-1/measurements') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <LogProvider>
          <Routes>
            <Route path="/grows/:growId/measurements" element={node} />
            <Route path="*" element={node} />
          </Routes>
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawScreen = async () => {
  draw(<Measurements />);
  await screen.findByRole('heading', { name: 'Measurements' });
};

const sent = () => vi.mocked(api.patch).mock.calls[0];

/** The template chips, which carry the same names as the cards above them. */
const templates = () => within(screen.getByRole('group', { name: 'Templates' }));

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  who.demo = false;
  state.measurements = [height, ec, runoff];
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.patch).mockImplementation(
    (_path: string, body: unknown) => Promise.resolve(grow((body as { measurements: MeasurementDefinition[] }).measurements)) as never,
  );
  vi.mocked(api.post).mockResolvedValue({ id: 'entry-new', kind: 'measurement', undoUntil: null } as never);
});

describe('what a grow measures', () => {
  it('says so where nothing is measured yet, and offers the templates', async () => {
    state.measurements = [];
    await drawScreen();

    expect(screen.getByText(/Nothing is measured here yet/)).toBeInTheDocument();
    expect(templates().getByRole('button', { name: /Water temp/ })).toBeEnabled();
    expect(screen.getByText(/A measurement is a Measure tile on the Log sheet/)).toBeInTheDocument();
  });

  it('draws each definition with its unit, its scope, its band and the rule no band can hold', async () => {
    await drawScreen();

    const rows = within(screen.getByRole('list', { name: 'Yours' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Height · cm');
    expect(rows[0]).toHaveTextContent('per plant');
    expect(rows[1]).toHaveTextContent('per grow · target 1.4–1.8');
    // A target that is not a band at all stays words beside the figure.
    expect(rows[2]).toHaveTextContent('aim under the input EC plus a fifth');
    expect(within(rows[2]).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('adds a template in one tap, sending the list it already had with the new row on the end', async () => {
    await drawScreen();

    fireEvent.click(templates().getByRole('button', { name: /Pot size/ }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(sent()[0]).toBe('/grows/grow-1');
    expect(sent()[1]).toEqual({
      measurements: [
        height,
        ec,
        runoff,
        { key: 'pot_size', name: 'Pot size', unit: 'L', perPlant: true, targetMin: null, targetMax: null, chart: false },
      ],
    });
  });

  it('will not offer a template the grow already measures', async () => {
    state.measurements = [{ key: 'water_temp', name: 'Water temp', unit: '°C', perPlant: false, targetMin: null, targetMax: null, chart: true }];
    await drawScreen();

    expect(templates().getByRole('button', { name: /Water temp/ })).toBeDisabled();
  });

  it('takes a measurement off the chart with the switch, and changes nothing else about it', async () => {
    await drawScreen();

    fireEvent.click(screen.getByRole('switch', { name: 'EC · input on the chart' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(sent()[1]).toEqual({ measurements: [height, { ...ec, chart: false }, runoff] });
  });

  it('shows the sentence the server refused with, rather than one of its own', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'measurement_key_twice',
        title: 'Unprocessable',
        detail: 'Two measurements of a grow cannot share a key.',
        errors: [{ field: 'measurements', code: 'duplicate', detail: 'height' }],
      }),
    );
    await drawScreen();

    fireEvent.click(templates().getByRole('button', { name: /Leaf temp/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Two measurements of a grow cannot share a key.');
  });

  it('offers a session that may only look nothing to change', async () => {
    who.demo = true;
    await drawScreen();

    expect(screen.queryByRole('group', { name: 'Templates' })).not.toBeInTheDocument();
    // The switch still says what is drawn; it simply cannot be moved.
    expect(screen.getByRole('switch', { name: 'Height on the chart' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Height on the chart' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('changing one measurement', () => {
  const openSheet = async (name: string) => {
    await drawScreen();
    // The series read says which keys have readings, so the sheet knows what is settled.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/series'), undefined, expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));
  };

  it('holds the scope and does not offer a delete once anything has been measured under it', async () => {
    await openSheet('Height');

    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'per plant' })).toBeDisabled();
    expect(within(sheet).getByText('Chosen once, and this one has readings.')).toBeInTheDocument();
    expect(within(sheet).getByText('3 readings are written under this one, so it stays. Turn it off the chart instead.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deletes one nothing has been written under, once it has been asked about', async () => {
    await openSheet('Runoff EC');

    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete it' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(sent()[1]).toEqual({ measurements: [height, ec] });
  });

  it('keeps the key when the name changes, so every reading already written stays named', async () => {
    await openSheet('EC · input');

    const sheet = screen.getByRole('dialog');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'EC in' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(sent()[1]).toEqual({ measurements: [height, { ...ec, name: 'EC in' }, runoff] });
  });
});

describe('the Measure sheet', () => {
  const openMeasure = async () => {
    draw(<MeasureSheet target={target} onClose={() => {}} />);
    await screen.findByRole('button', { name: /Height/ });
  };

  it('opens on the first plant and writes one line of what was typed, keyed by measurement and plant', async () => {
    await openMeasure();

    // What was measured last time, and for the plant beside it.
    expect(screen.getByText(/last 58 cm/)).toHaveTextContent('Amnesia 2 was 54');

    fireEvent.click(screen.getByRole('button', { name: '6' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('status')).toHaveTextContent('62');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/entries');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({
      kind: 'measurement',
      growId: 'grow-1',
      values: { kind: 'measurement', readings: [{ key: 'height', value: 62, plantId: 'plant-1' }] },
    });
  });

  it('offers only what is measured of the grow while the whole grow is chosen', async () => {
    await openMeasure();

    fireEvent.click(screen.getByRole('button', { name: 'Whole grow' }));

    expect(screen.queryByRole('button', { name: /Height/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EC · input/ })).toBeInTheDocument();
    // A round of plants is over: there is one figure to take, and Save takes it.
    expect(screen.queryByRole('button', { name: 'Save and next plant' })).not.toBeInTheDocument();
  });

  it('sends nothing at all until something has been typed', async () => {
    await openMeasure();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
