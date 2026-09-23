import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, Plant, SpaceOverview } from '@fg2/shared-types/v1';
import { HarvestSheet } from '@/screens/grow/HarvestSheet';
import { correctionEffect, withdrawalEffect } from '@/screens/grow/phase-effect';
import { PresetSheet } from '@/screens/space/PresetSheet';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * What the lifecycle sheets promise before anything is sent.
 *
 * All three of these are the app saying what a tap will do, which is the one
 * thing it cannot get wrong: a correction that moves the day counter somewhere
 * else than it said, a total shared out differently than it showed, or a stage
 * reported as written to a tent that was never touched would each be worse than
 * having said nothing.
 */

const NOW = DateTime.fromISO('2026-09-18T12:00:00.000Z');
const at = (daysAgo: number) => NOW.minus({ days: daysAgo }).set({ hour: 10 }).toISO()!;

const phase = (id: string, stage: GrowListItem['phases'][number]['stage'], daysAgo: number): GrowListItem['phases'][number] => ({
  id,
  stage,
  preset: null,
  startedAt: at(daysAgo),
  source: 'human',
  plantIds: null,
  deviceId: null,
  targets: null,
  setBy: 'user-1',
});

const grow: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  description: null,
  type: 'photoperiod',
  phases: [phase('p1', 'vegetative', 34), phase('p2', 'flowering', 10)],
  placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: at(34), endedAt: null, plantIds: null }],
  scheme: null,
  measurements: [],
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
    preset: null,
    phaseDay: 11,
    weekNumber: 5,
    isAuto: false,
    groups: [],
    locations: [{ spaceId: 'space-1', plantIds: ['plant-1', 'plant-2', 'plant-3'] }],
  },
};

const plant = (id: string, label: string, over: Partial<Plant> = {}): Plant => ({
  id,
  growId: 'grow-1',
  strain: 'Amnesia',
  label,
  status: 'active',
  harvest: null,
  createdAt: at(34),
  ...over,
});

const plants = [plant('plant-1', 'Amnesia 1'), plant('plant-2', 'Amnesia 2'), plant('plant-3', 'Gelato 1', { strain: 'Gelato' })];

const overview: SpaceOverview = {
  spaceId: 'space-1',
  name: 'Blue Dream tent',
  kind: 'tent',
  roomId: null,
  deviceIds: ['device-1'],
  values: [],
  setpoints: [],
  targets: null,
  verdict: {
    deviceId: 'device-1',
    startsAt: at(1),
    endsAt: at(0),
    forSeconds: 86_400,
    stepSeconds: 120,
    rating: null,
    inBandFraction: null,
    metrics: [],
    actuators: [],
    trend: null,
  },
  grows: [
    {
      growId: 'grow-1',
      name: 'Spring run',
      type: 'photoperiod',
      dayNumber: 35,
      phaseDay: 11,
      weekNumber: 5,
      stage: 'flowering',
      preset: null,
      isAuto: false,
      plantCount: 3,
      strains: ['Amnesia', 'Gelato'],
      coverMediaId: null,
      stageGroups: [],
      placedAt: at(34),
      placedOnDay: 1,
    },
  ],
  cameras: [],
  entries: [],
  readingNames: [],
  dueTasks: [],
  openAlerts: [],
  people: [],
};

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

describe('what correcting a phase would move', () => {
  it('takes the days off the counter that the date was moved by, and says so in weeks as well', () => {
    const effect = correctionEffect(grow, grow.phases[0], { stage: 'vegetative', preset: null, startedAt: at(31) });

    expect(effect.growDay).toEqual({ from: 35, to: 32 });
    expect(effect.stage).toBeNull();
    expect(effect.timelineOnly).toBe(false);
  });

  it('moves the phase the grow stands in, and the stage with it, when the latest one is corrected', () => {
    const effect = correctionEffect(grow, grow.phases[1], { stage: 'drying', preset: null, startedAt: at(7) });

    expect(effect.phaseDay).toEqual({ from: 11, to: 8 });
    expect(effect.stage).toEqual({ from: 'flowering', to: 'drying' });
    expect(effect.growDay).toBeNull();
  });

  it('says nothing moves where a phase in the middle of the story only changes its own date', () => {
    const middle = { ...grow, phases: [...grow.phases, phase('p3', 'drying', 2)] };
    const effect = correctionEffect(middle, middle.phases[1], { stage: 'flowering', preset: null, startedAt: at(9) });

    expect(effect.timelineOnly).toBe(true);
  });

  it('says what a grow is left with when its only phase is withdrawn', () => {
    const effect = withdrawalEffect({ ...grow, phases: [grow.phases[0]] }, grow.phases[0]);

    expect(effect.noPhaseLeft).toBe(true);
    expect(effect.stage).toBeNull();
  });

  it('hands the day counter back to the phase that follows the one withdrawn', () => {
    const effect = withdrawalEffect(grow, grow.phases[0]);

    expect(effect.growDay).toEqual({ from: 35, to: 11 });
  });
});

describe('the harvest sheet', () => {
  it('shares the total out over the plants named, before anything is sent', () => {
    draw(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Amnesia 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Amnesia 2' }));
    fireEvent.change(screen.getAllByPlaceholderText('—')[0], { target: { value: '420' } });

    expect(screen.getByText('420 g wet shared over 2 plants · about 210 g each.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Harvest 2 plants' })).toBeInTheDocument();
  });

  it('says the grow ends before the last plants come down, and on which day', () => {
    draw(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);

    expect(screen.getByText(/These are the last plants standing/)).toHaveTextContent('its day counter stops there');
    expect(screen.getByRole('button', { name: /end the grow/ })).toBeInTheDocument();
  });

  it('keeps a plant that has already come down on the list, dimmed and unpickable, with what it weighed', () => {
    const down = [
      plants[0],
      plants[1],
      plant('plant-3', 'Gelato 1', { status: 'harvested', harvest: { harvestedAt: at(1), wetWeightG: 90, dryWeightG: null } }),
    ];
    draw(<HarvestSheet grow={grow} plants={down} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Gelato 1' })).toBeDisabled();
    expect(screen.getByText(/wet 90 g/)).toBeInTheDocument();
  });

  it('keeps the unit over the weights in the figure face', () => {
    draw(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);

    expect(screen.getByText('grams, as a total').className).toMatch(/mono/);
  });
});

describe('the climate preset sheet', () => {
  it('says a preset writes the target climate and nothing else, and which grow follows it', () => {
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    expect(screen.getByText(/A preset writes the target climate and nothing else/)).toHaveTextContent('stay as they are');
    expect(screen.getByText('Spring run enters the stage with it.')).toBeInTheDocument();
  });

  it('says curing writes nothing at all rather than offering a climate it has not got', () => {
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Curing' }));

    expect(screen.getByText(/Curing has no climate of its own/)).toHaveTextContent('writes nothing to anything standing here');
    expect(screen.queryByRole('button', { name: 'Late flower' })).not.toBeInTheDocument();
  });
});
