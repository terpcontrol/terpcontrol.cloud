import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Device, GrowListItem, Plant } from '@fg2/shared-types/v1';
import { HarvestSheet } from '@/screens/grow/HarvestSheet';
import { GrowLifecycle } from '@/screens/grow/Lifecycle';
import { MoveSheet } from '@/screens/grow/MoveSheet';
import { RenameSheet } from '@/screens/grow/RenameSheet';
import { SplitSheet } from '@/screens/grow/SplitSheet';
import { PhaseSheet } from '@/screens/grow/PhaseSheet';
import { correctionEffect, withdrawalEffect } from '@/screens/grow/phase-effect';
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

/**
 * The name, which is the one thing about a grow the app could not change.
 *
 * It is invented by the sheet that makes the grow - "Mimosa Sunrise XXL Auto
 * [8]" - and then stands on the home card, the header, the report and the
 * public diary for the whole run. The route has always taken a new one; only
 * the app withheld it, so a strain typed wrong could be corrected nowhere but
 * by throwing the grow and its diary away.
 */
describe('renaming a grow', () => {
  it('is offered beside the other moves, for a session that may make them', () => {
    draw(<GrowLifecycle grow={grow} plants={plants} spaces={[]} />);

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('sends the trimmed name and nothing else, because a rename moves nothing that was recorded', async () => {
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

    draw(<RenameSheet grow={grow} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  Spring run, Amnesia  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    const wrote = () => asked.filter(call => call.method !== 'GET');
    await waitFor(() => expect(wrote()).toHaveLength(1));
    expect(wrote()[0].method).toBe('PATCH');
    expect(wrote()[0].path).toBe('/v1/grows/grow-1');
    expect(wrote()[0].body).toEqual({ name: 'Spring run, Amnesia' });
  });

  it('will not save an empty name, nor the one the grow already has', () => {
    draw(<RenameSheet grow={grow} onClose={() => {}} />);

    const save = screen.getByRole('button', { name: 'Save the name' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '   ' } });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Autumn run' } });
    expect(save).toBeEnabled();
  });
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

  /** The server leaves a start that came before every phase where it is, so the grow's days do not move and the sheet does not say they will. */
  it('promises nothing about the day counter where the grow began before its first phase', () => {
    const writtenDownFirst = { ...grow, startedAt: at(40), summary: { ...grow.summary, dayNumber: 41 } };
    const effect = correctionEffect(writtenDownFirst, grow.phases[0], { stage: 'vegetative', preset: null, startedAt: at(31) });

    expect(effect.growDay).toBeNull();
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
    // Only the writes are counted: the sheet dates the grow's end where the
    // account is, and reading the account for its zone is a GET like any other.
    const wrote = () => asked.filter(call => call.method !== 'GET');
    await waitFor(() => expect(wrote()).toHaveLength(1));
    expect(wrote()[0].method).toBe('PATCH');
    expect(wrote()[0].path).toBe('/v1/grows/grow-1');
    expect(Object.keys(wrote()[0].body as object)).toEqual(['endedAt']);
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

  it('offers no move of its own, only the rows of where it stood', () => {
    draw(<MoveSheet grow={finished} plants={plants} spaces={[tent]} onClose={() => {}} />);

    expect(screen.queryByRole('button', { name: /^Move · / })).not.toBeInTheDocument();
    expect(screen.getByText(/This grow has ended, so it does not move any more/)).toBeInTheDocument();
  });

  it('is offered a phase, a move and a new name, but no split and no harvest', () => {
    draw(<GrowLifecycle grow={finished} plants={plants} spaces={[tent]} />);

    const offered = screen.getAllByRole('button').map(button => button.textContent);
    expect(offered).toEqual(['Phase', 'Move', 'Rename']);
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
  control: null,
  isDemo: false,
  state: {
    lastSeenAt: at(0),
    claimedAt: at(60),
    firmwareId: 'build-1',
    updateStartedAt: null,
    updateEndedAt: null,
    updateFailedAt: null,
    maintenanceUntil: null,
    // With the sensor, which is what makes the preset's CO2 row one that is
    // written at all: a controller reporting none holds its target at zero.
    hardware: { co2: 'on' },
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
  ...over,
});

/**
 * Moving into a stage asks whether the tent's climate moves with it. Moving
 * into flower is when the light is expected to go to twelve hours, and the
 * phase picker used to move the stage alone without a word about the light.
 */
describe('the climate beside a phase', () => {
  const tent = (over: Partial<Device> = {}): Device => ({
    ...standing(over),
    configuration: {
      day: { temperature: 26, humidity: 62 },
      night: { temperature: 22, humidity: 58 },
      lights: { limit: 80 },
      daynight: { day: 21600, night: 0 },
    },
  });
  const veg: GrowListItem = { ...grow, phases: [phase('p1', 'vegetative', 20)], summary: { ...grow.summary, stage: 'vegetative' } };

  // The window is said on the account's clock; with no account read, that is the browser's, held at UTC here.
  beforeAll(() => {
    Settings.defaultZone = 'utc';
  });
  afterAll(() => {
    Settings.defaultZone = 'system';
  });

  it('leaves the targets as they are unless a climate is chosen, and says what they stay at', () => {
    hardware.devices = [tent()];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    const choices = screen.getByRole('group', { name: 'Targets' });
    expect(within(choices).getByRole('button', { name: 'Leave as they are' })).toHaveAttribute('aria-pressed', 'true');
    // The climates of the stage, by the names the chips under Control carry.
    expect(within(choices).getByRole('button', { name: 'Flower' })).toBeInTheDocument();
    expect(within(choices).getByRole('button', { name: 'Late flower' })).toBeInTheDocument();
    expect(within(choices).getByRole('button', { name: 'Auto · Flower' })).toBeInTheDocument();
    // Eighteen hours from six in the morning: said as the window it makes, which ends at midnight.
    expect(screen.getByText(/Stay: Light on 06:00–00:00 · 18 h · day 26 °C · night 22 °C · 62 %/)).toBeInTheDocument();
  });

  it('puts the tent on the stage´s own climate with the phase when that is chosen, and says what it sets', async () => {
    const asked: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(phase('p3', 'flowering', 0)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    hardware.devices = [tent()];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Flower' }));
    // A preset moves how long the light is on, never when it comes on: twelve hours from the device's six.
    expect(screen.getByText(/New: Light on 06:00–18:00 · 12 h · day 25 °C · night 20 °C · 50 % – replaces the targets/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter Flower' }));

    await waitFor(() => expect(asked.filter(call => call.method === 'POST')).toHaveLength(1));
    expect(asked.find(call => call.method === 'POST')?.body).toMatchObject({ stage: 'flowering', preset: null, climate: true });
  });

  /**
   * Drying with the targets left as they are named a light window, a day and a
   * night the device was about to stop having, and the day's humidity it would
   * not hold.
   */
  it('says what drying holds where the targets are left, and nothing of a light or a day', () => {
    hardware.devices = [tent()];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Drying' }));
    expect(
      screen.getByText(/^Drying holds the night figures as they are, round the clock: 22 °C · 58 % – no light and no CO₂\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Light on 06:00/)).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Drying' }));
    expect(screen.getByText(/^New: light off · 18 °C · 58 % – replaces the targets under Control\. The device starts drying/)).toBeInTheDocument();
  });

  /**
   * Germination means one thing everywhere: seeds in the dark. A phase written
   * alone is the record of them sprouting and darkens nothing; the climate of
   * the same name puts the device into its dark germination mode.
   */
  it('keeps the light where only the germination phase is written, and darkens the device for its climate', async () => {
    const asked: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(phase('p3', 'germination', 0)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    hardware.devices = [{ ...tent(), type: 'fridge', control: { running: true, drying: false, mode: 'standard', energySaving: false } }];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    // The stage chip records the stage and is called by it; the one choice that darkens is the climate beside it.
    expect(screen.queryAllByRole('button', { name: 'Germination · dark' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Germination' }));
    expect(
      screen.getByText(
        /^Stay: Light on 06:00–00:00 · 18 h · .* The light stays on: only “Germination · dark” makes it dark\. The alarms stay as they are: they belong to the climate the device goes on holding\.$/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Germination · dark' }));
    expect(
      screen.getByText(
        /^New: Germination · dark – light off, no CO₂, 24 °C and 75 % humidity round the clock, the humidity held by a humidifier alone\..* The alarms Too hot and Too cold follow germination; Too humid is set to above 90 %: It rests until germination ends\.$/,
      ),
    ).toBeInTheDocument();
    // What germination does about the humidity is asked beside its climate: the alarm, and no humidifier where none is paired.
    const choices = screen.getByRole('group', { name: 'During germination' });
    expect(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' })).toHaveAttribute('aria-checked', 'false');
    expect(within(choices).queryByRole('switch', { name: 'Hold the humidity with the humidifier' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter Germination' }));

    await waitFor(() => expect(asked.filter(call => call.method === 'POST')).toHaveLength(1));
    expect(asked.find(call => call.method === 'POST')?.body).toMatchObject({ stage: 'germination', preset: null, climate: true });
    // Nothing moved, so nothing is said: the device keeps what it has.
    expect(asked.find(call => call.method === 'POST')?.body).not.toHaveProperty('germinationChoices');
  });

  it('sends what germination is to do about the humidity with its climate, where a switch was moved', async () => {
    const asked: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace(/^\/v1/, '');
        asked.push({ method: init?.method ?? 'GET', path, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
        // The device has a humidifier paired, which is what offers the second switch.
        const answer = path.endsWith('/sockets')
          ? {
              items: [
                { slot: 0, role: 'humidifier', hardwareId: '', address: '10.0.0.9', state: 'off', override: null, timer: null, stateChangedAt: null },
              ],
              nextCursor: null,
            }
          : phase('p3', 'germination', 0);
        return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    hardware.devices = [{ ...tent(), type: 'fridge', control: { running: true, drying: false, mode: 'standard', energySaving: false } }];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Germination' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Germination · dark' }));
    const choices = screen.getByRole('group', { name: 'During germination' });
    const humidifier = await within(choices).findByRole('switch', { name: 'Hold the humidity with the humidifier' });
    expect(humidifier).toHaveAttribute('aria-checked', 'true');
    expect(within(choices).getByText(/^The humidifier holds \d+ % – it never makes it wetter than that\.$/)).toBeInTheDocument();

    fireEvent.click(humidifier);
    fireEvent.click(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' }));
    expect(within(choices).getByText('The humidifier rests until germination ends.')).toBeInTheDocument();
    expect(screen.getByText(/Too humid is set to above 90 %: It warns during germination too\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter Germination' }));

    await waitFor(() => expect(asked.filter(call => call.method === 'POST')).toHaveLength(1));
    expect(asked.find(call => call.method === 'POST')?.body).toMatchObject({
      stage: 'germination',
      climate: true,
      germinationChoices: { warnTooHumid: true, humidifierHolds: false },
    });
  });

  it('offers the seedling´s climate first while the device germinates, and says the light comes back either way', () => {
    const germinating: GrowListItem = {
      ...grow,
      phases: [phase('p1', 'germination', 3)],
      summary: { ...grow.summary, stage: 'germination' },
    };
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false };
    hardware.devices = [
      {
        ...tent(),
        type: 'fridge',
        control: {
          ...dark,
          afterGermination: { dayTemperature: null, dayHumidity: null, nightTemperature: 19, nightHumidity: null, co2: null, lightLimit: null },
        },
      },
    ];
    draw(<PhaseSheet grow={germinating} onClose={() => {}} />);

    const choices = screen.getByRole('group', { name: 'Targets' });
    expect(within(choices).getByRole('button', { name: 'Seedling · with light' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(
        /^New: Light on 06:00–00:00 · 18 h · day 24 °C · night 21 °C · 70 % – .* Germination ends: the device holds day and night again/,
      ),
    ).toBeInTheDocument();

    // Left as they are, the night germination wrote over comes back with the light.
    fireEvent.click(within(choices).getByRole('button', { name: 'Leave as they are' }));
    expect(screen.getByText(/^Stay: Light on 06:00–00:00 · 18 h · day 26 °C · night 19 °C · 62 %\. Germination ends/)).toBeInTheDocument();
  });

  it('is not asked where nothing standing there states a climate', () => {
    hardware.devices = [];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    expect(screen.queryByRole('group', { name: 'Targets' })).not.toBeInTheDocument();
  });

  it('says curing has no climate rather than offering one', () => {
    hardware.devices = [tent()];
    draw(<PhaseSheet grow={veg} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Curing' }));
    expect(screen.queryByRole('group', { name: 'Targets' })).not.toBeInTheDocument();
    expect(screen.getByText(/Curing has no climate of its own/)).toBeInTheDocument();
  });
});
