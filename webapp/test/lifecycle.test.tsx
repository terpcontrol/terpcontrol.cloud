import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Device, GrowListItem, Plant, SpaceOverview } from '@fg2/shared-types/v1';
import { HarvestSheet } from '@/screens/grow/HarvestSheet';
import { MoveSheet } from '@/screens/grow/MoveSheet';
import { SplitSheet } from '@/screens/grow/SplitSheet';
import { PhaseSheet } from '@/screens/grow/PhaseSheet';
import { correctionEffect, withdrawalEffect } from '@/screens/grow/phase-effect';
import { PresetSheet } from '@/screens/space/PresetSheet';
import { spaceWhere } from './session';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/** What stands in the tent, which is what a preset can reach - the sheet reads the same list the Control tab does. */
const hardware = vi.hoisted(() => ({ devices: [] as unknown[] }));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({ data: { items: hardware.devices, nextCursor: null }, isPending: false, refetch: () => {} }),
}));

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
    stageWeek: 2,
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
      stageWeek: 2,
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

/**
 * The sheet over a grow that holds no plant list at all, which is every grow
 * brought over from the old app. An empty list of standing plants used to be
 * read as "they have all come down", so a grow in its fourth week of flower was
 * told its harvest was over - and because ending a grow is what the last
 * harvest does, that sentence was also the end of every route to finishing it.
 */
describe('the harvest sheet over a grow whose record carries no plants', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not tell a running grow that every plant has already come down', () => {
    draw(<HarvestSheet grow={grow} plants={[]} onClose={() => {}} />);

    expect(screen.queryByText('Every plant of this grow has already come down.')).not.toBeInTheDocument();
    expect(screen.getByText(/No plants are recorded in this grow/)).toBeInTheDocument();
  });

  it('offers the end of the grow itself, and writes it on the grow rather than as a harvest of nothing', async () => {
    const asked: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({
          method: init?.method ?? 'GET',
          path: new URL(String(input), 'http://localhost').pathname,
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return new Response(JSON.stringify(grow), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );

    draw(<HarvestSheet grow={grow} plants={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'End the grow' }));

    // The server refuses a harvest with nothing in it, so this goes to the grow
    // itself - the same `endedAt` the last plant's harvest would have written.
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].method).toBe('PATCH');
    expect(asked[0].path).toBe('/v1/grows/grow-1');
    expect(Object.keys(asked[0].body as object)).toEqual(['endedAt']);
  });

  it('says when a grow that is already over ended, rather than offering to end it a second time', () => {
    draw(<HarvestSheet grow={{ ...grow, endedAt: at(2) }} plants={[]} onClose={() => {}} />);

    expect(screen.getByText('It ended on 16 Sep 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End the grow' })).not.toBeInTheDocument();
  });
});

/**
 * A split of a grow with no plants in its record, which every grow brought over
 * from the old app is. There is nothing to split off, and the sheet used to
 * draw the whole machinery over it and refuse at the end.
 */
describe('the split sheet over a grow whose record carries no plants', () => {
  const tent = spaceWhere('own', { name: 'Blue Dream tent' });

  it('says so and offers nothing, the way the harvest sheet does over the same record', () => {
    draw(<SplitSheet grow={grow} plants={[]} spaces={[tent]} onClose={() => {}} />);

    expect(screen.getByText(/No plants are recorded in this grow, so there is nothing here to split off/)).toBeInTheDocument();
    // Not the picker, not the phase or place chips, and no button that leads to
    // a refusal: the server wants at least one plant.
    expect(screen.queryByRole('button', { name: /Split off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep the phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Blue Dream tent' })).not.toBeInTheDocument();
  });

  it('is the whole sheet for a grow that does have plants', () => {
    draw(<SplitSheet grow={grow} plants={plants} spaces={[tent]} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /Split off/ })).toBeInTheDocument();
    expect(screen.queryByText(/No plants are recorded/)).not.toBeInTheDocument();
  });
});

/**
 * Where a grow that stands nowhere any more stood. `summary.locations` is empty
 * once the last placement is closed, and the sheet read that as a present fact.
 */
describe('the move sheet of a grow that has ended', () => {
  const tent = spaceWhere('own', { name: 'Blue Dream tent' });
  const finished: GrowListItem = {
    ...grow,
    endedAt: at(0),
    placements: [{ id: 'pl1', spaceId: 'space-1', startedAt: at(34), endedAt: at(0), plantIds: null }],
    summary: { ...grow.summary, locations: [] },
  };

  it('names the place it stood in, as the header behind it and its own history do', () => {
    draw(<MoveSheet grow={finished} plants={plants} spaces={[tent]} onClose={() => {}} />);

    expect(screen.getByText('stood in Blue Dream tent')).toBeInTheDocument();
    expect(screen.queryByText('Standing in No fixed place')).not.toBeInTheDocument();
  });

  it('still says in the present where a running grow stands', () => {
    draw(<MoveSheet grow={grow} plants={plants} spaces={[tent]} onClose={() => {}} />);

    expect(screen.getByText('Standing in Blue Dream tent')).toBeInTheDocument();
  });

  /** "No fixed place" is a place a grow can be in, and a running grow that is in it says so. */
  it('says a running grow stands in no fixed place where that is what it does', () => {
    draw(<MoveSheet grow={{ ...grow, summary: { ...grow.summary, locations: [] } }} plants={plants} spaces={[tent]} onClose={() => {}} />);

    expect(screen.getByText('Standing in No fixed place')).toBeInTheDocument();
  });
});

/**
 * A finished grow's phase sheet. Its figures are frozen at the day it came
 * down, so every present tense on it is a claim about today that the grow
 * cannot make - which is what the phase bar above it already refuses to say.
 * The actions stay, because this is the only way left to repair a finished
 * grow's phase list.
 */
describe('the phase sheet over a grow that has ended', () => {
  const finished: GrowListItem = { ...grow, endedAt: at(0) };

  it('says what the grow finished as and when, rather than what it is doing now', () => {
    draw(<PhaseSheet grow={finished} onClose={() => {}} />);

    expect(screen.getByText('Ended in Flower on day 35 of the grow · 18 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText(/^Now /)).not.toBeInTheDocument();
    // A grow that is over is in no stage, so no stage is marked as the one it is in.
    expect(screen.queryByRole('button', { name: /· now/ })).not.toBeInTheDocument();
  });

  it('keeps the phase list repairable, worded as a record rather than a move, dated to the day it ended', () => {
    draw(<PhaseSheet grow={finished} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Record Drying' })).toBeEnabled();
    expect(screen.getByText(/This grow is over/)).toBeInTheDocument();
    // Not today: a phase filed a month after the plants came down would be a
    // stage the grow never stood in.
    expect(screen.getByLabelText('On')).toHaveValue('2026-09-18');
  });

  it('speaks in the present over a grow that is still running, which is what the ended wording is told against', () => {
    draw(<PhaseSheet grow={grow} onClose={() => {}} />);

    expect(screen.getByText('Now Flower · day 11 of the phase · day 35, week 5 of the grow')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter Drying' })).toBeInTheDocument();
  });
});

const standing = (over: Partial<Device> = {}): Device => ({
  id: 'device-1',
  createdAt: at(60),
  type: 'controller',
  classId: null,
  serialNumber: 42,
  ownerId: 'user-1',
  spaceId: 'space-1',
  name: 'Blue Dream controller',
  firmware: { channel: 'stable', targetId: null },
  configuration: { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 } },
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  isDemo: false,
  state: {
    lastSeenAt: at(0),
    claimedAt: at(60),
    firmwareId: 'build-1',
    updateStartedAt: null,
    updateEndedAt: null,
    maintenanceUntil: null,
    hardware: {},
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
  ...over,
});

describe('the climate preset sheet', () => {
  it('says a preset writes the target climate and nothing else, and which grow follows it', () => {
    hardware.devices = [standing()];
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    expect(screen.getByText(/A preset writes the target climate and nothing else/)).toHaveTextContent('stay as they are');
    expect(screen.getByText('Spring run enters the stage with it.')).toBeInTheDocument();
  });

  it('says curing writes nothing at all rather than offering a climate it has not got', () => {
    hardware.devices = [standing()];
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Curing' }));

    expect(screen.getByText(/Curing has no climate of its own/)).toHaveTextContent('writes nothing to anything standing here');
    expect(screen.queryByRole('button', { name: 'Late flower' })).not.toBeInTheDocument();
  });

  // A tent is not its device count: a plug is a device and holds no climate,
  // which is what the Manual targets tab of the same tent has always said.
  it('says there is nothing to write to when the only thing standing here states no climate', () => {
    hardware.devices = [standing({ type: 'plug', configuration: null })];
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    expect(screen.getByText('Nothing standing here states a climate, so there is nothing to write one to.')).toBeInTheDocument();
  });

  it('says a controller whose settings have not arrived is waited on, rather than promising a write into nothing', () => {
    hardware.devices = [standing({ configuration: null })];
    draw(<PresetSheet overview={overview} onClose={() => {}} />);

    expect(screen.getByText(/has sent its settings yet/)).toHaveTextContent('written when the hardware next connects');
  });

  it('keeps quiet about the hardware for a reader who was never told what stands here', () => {
    hardware.devices = [];
    draw(<PresetSheet overview={{ ...overview, deviceIds: null }} onClose={() => {}} />);

    expect(screen.queryByText(/nothing to write/i)).not.toBeInTheDocument();
  });

  it('drops the promise that the climate is written anyway when there is nowhere for it to go', () => {
    hardware.devices = [standing({ type: 'plug', configuration: null })];
    draw(<PresetSheet overview={{ ...overview, grows: [] }} onClose={() => {}} />);

    expect(screen.getByText(/nothing to write a climate into either/)).toHaveTextContent('no phase is written');
    expect(screen.queryByText(/The climate is written either way/)).not.toBeInTheDocument();
  });
});
