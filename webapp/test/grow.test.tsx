import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, GrowWeekCard } from '@fg2/shared-types/v1';
import { PhaseBar } from '@/screens/grow/PhaseBar';
import { WeekCard } from '@/screens/grow/WeekCard';

// A picture's address needs the session's media token, and what a screen offers
// depends on who is looking, so both are answered here rather than reached for.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

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
    { key: 'height', name: 'Height', unit: 'cm', perPlant: false, target: null, chart: true },
    { key: 'ph', name: 'pH', unit: '', perPlant: false, target: 6.3, chart: true },
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
