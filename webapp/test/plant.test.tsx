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
import { PlantPage } from '@/screens/grow/plant/PlantPage';

/**
 * One plant's page: what is true of this plant and of no other.
 *
 * The readings it draws are the grow's series filtered to this plant, the lines
 * are the ones that name it alone, and its one write is what it is called. A
 * chart is drawn on a canvas jsdom does not have, so it stands in as the label
 * it would have carried - what the curve is made of is asserted elsewhere.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const height: MeasurementDefinition = { key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true };

const grow: GrowListItem = {
  id: 'grow-1',
  name: 'Spring run',
  phases: [
    {
      id: 'p1',
      stage: 'flowering',
      preset: null,
      startedAt: at(35),
      source: 'human',
      plantIds: null,
      deviceId: null,
      targets: null,
      setBy: 'user-1',
    },
  ],
  placements: [],
  measurements: [height],
  startedAt: at(35),
  summary: { dayNumber: 35, stage: 'flowering', preset: null, phaseDay: 35, weekNumber: 5, isAuto: false, groups: [], locations: [] },
} as unknown as GrowListItem;

const plant = (id: string, label: string): Plant =>
  ({ id, growId: 'grow-1', strain: 'Amnesia', label, status: 'active', harvest: null, createdAt: at(35) }) as Plant;

const plants = [plant('plant-1', 'Amnesia 1'), plant('plant-2', 'Amnesia 2')];

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

const entry = (over: Partial<Entry>): Entry =>
  ({
    id: 'e-2',
    createdAt: at(3),
    kind: 'measurement',
    occurredAt: at(3),
    source: 'human',
    authorId: 'user-1',
    growId: 'grow-1',
    spaceId: null,
    deviceId: null,
    plantIds: ['plant-1'],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: null,
    text: null,
    message: null,
    values: { kind: 'measurement', readings: [{ key: 'height', value: 58, plantId: 'plant-1' }] },
    mediaIds: [],
    undoUntil: null,
    ...over,
  }) as Entry;

const lines = [
  entry({}),
  entry({ id: 'e-4', kind: 'training', occurredAt: at(17), text: 'Topped above node 5', values: { kind: 'training' } }),
  entry({ id: 'e-5', kind: 'photo', occurredAt: at(5), mediaIds: ['media-1'], values: { kind: 'photo' } }),
];

const state = { lines, series };

const answers = (path: string) => {
  if (path.startsWith('/grows/grow-1/series')) return state.series;
  if (path === '/grows/grow-1/plants') return { items: plants, nextCursor: null };
  if (path === '/grows/grow-1') return grow;
  if (path === '/entries') return { items: state.lines, nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/grows/grow-1/plants/plant-1']}>
        <Routes>
          <Route path="/grows/:growId/plants/:plantId" element={<PlantPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawLoaded = async () => {
  draw();
  await screen.findByRole('heading', { name: 'Amnesia 1' });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/series'), undefined, expect.anything()));
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  who.demo = false;
  state.lines = lines;
  state.series = series;
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.patch).mockResolvedValue(plant('plant-1', 'Tall one') as never);
});

describe('a plant of a grow', () => {
  it('names the plant, the grow and which of its plants this is', async () => {
    await drawLoaded();

    expect(screen.getByRole('heading', { name: 'Amnesia 1' })).toBeInTheDocument();
    expect(screen.getByText(/Spring run/)).toHaveTextContent('1 of 2');
    expect(screen.getByText('Amnesia · Flower')).toBeInTheDocument();
  });

  it('draws its own figures: where its measurement stands, its last training and how far into the grow it is', async () => {
    await drawLoaded();

    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('cm · +6 in 3 d')).toBeInTheDocument();
    expect(screen.getByText('d19')).toBeInTheDocument();
    expect(screen.getByText('Day 35')).toBeInTheDocument();
  });

  it('charts what was measured on it, with the other plants of the grow beside it', async () => {
    await drawLoaded();

    expect(await screen.findByRole('img', { name: 'Height of Amnesia 1 over the grow' })).toBeInTheDocument();
    expect(screen.getByText('other plants')).toBeInTheDocument();
  });

  it('lists the lines that name this plant, by the day of the grow they happened on', async () => {
    await drawLoaded();

    const own = within(screen.getByRole('list', { name: 'Own entries' })).getAllByRole('listitem');
    expect(own[0]).toHaveTextContent('D 33');
    expect(own[0]).toHaveTextContent('Height 58 cm');
    expect(own[1]).toHaveTextContent('Topped above node 5');
    expect(screen.getByText('grow entries apply too')).toBeInTheDocument();
  });

  it('says what is missing rather than drawing an empty frame', async () => {
    state.lines = [];
    state.series = { ...series, measurements: [] };
    await drawLoaded();

    expect(screen.getByText('No photo of this plant yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing logged about this plant on its own')).toBeInTheDocument();
    expect(screen.getByText('Nothing measured for this plant yet')).toBeInTheDocument();
  });

  it('renames the plant, sending what was typed and nothing else', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Label' }), { target: { value: 'Tall one' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0][0]).toBe('/plants/plant-1');
    expect(vi.mocked(api.patch).mock.calls[0][1]).toEqual({ label: 'Tall one', strain: 'Amnesia' });
  });

  it('shows the sentence the server refused the rename with', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({ status: 403, code: 'demo_session', title: 'Forbidden', detail: 'The demo account cannot change anything.', errors: [] }),
    );
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The demo account cannot change anything.');
  });

  it('offers a session that may only look nothing to change', async () => {
    who.demo = true;
    await drawLoaded();

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });
});
