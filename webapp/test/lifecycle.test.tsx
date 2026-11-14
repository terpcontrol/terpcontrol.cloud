import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime, Settings } from 'luxon';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Device, GrowListItem, Plant } from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { HarvestSheet } from '@/screens/grow/HarvestSheet';
import { GrowMenu } from '@/screens/grow/GrowMenu';
import { MoveSheet } from '@/screens/grow/MoveSheet';
import { RenameSheet } from '@/screens/grow/RenameSheet';
import { SplitSheet } from '@/screens/grow/SplitSheet';
import { PhaseSheet } from '@/screens/grow/PhaseSheet';
import { correctionEffect, withdrawalEffect } from '@/screens/grow/phase-effect';
import { deviceWith } from './fixtures';
import { drawAt, testClient, json, reading } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

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
    zone: 'UTC',
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

beforeAll(() => translate());

/**
 * What can be done to a grow stands behind the menu beside its name; a
 * desktop has the phase and sharing as buttons of their own beside it.
 */
describe('the grow´s menu', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: `More about ${grow.name}` }));
  const offered = () => {
    const list = document.getElementById(screen.getByRole('button', { name: `More about ${grow.name}` }).getAttribute('aria-controls')!)!;
    return [...list.children].map(item => item.textContent);
  };

  it('offers every change to whoever owns the grow, and what it measures and the stage´s tips to everybody', () => {
    drawAt(<GrowMenu grow={grow} plants={plants} spaces={[]} mayManage mayOwn />);
    open();

    expect(offered()).toEqual(['Phase', 'Share', 'Measurements', 'Move', 'Split', 'Harvest', 'Name and type', 'Tips for this phase']);
    expect(screen.getByRole('link', { name: 'Measurements' })).toHaveAttribute('href', `/grows/${grow.id}/measurements`);
  });

  it('offers a session that may only look nothing that changes the grow', () => {
    drawAt(<GrowMenu grow={grow} plants={plants} spaces={[]} mayManage={false} mayOwn={false} />);
    open();

    expect(offered()).toEqual(['Measurements', 'Tips for this phase']);
  });

  it('opens four tips for the stage the grow is in', () => {
    drawAt(<GrowMenu grow={grow} plants={plants} spaces={[]} mayManage={false} mayOwn={false} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Tips for this phase' }));

    const tips = screen.getByRole('dialog', { name: 'Tips for this phase' });
    expect(within(tips).getAllByRole('listitem')).toHaveLength(4);
    expect(tips).toHaveTextContent(/Keep humidity at or below 50 %/);
  });
});

/**
 * A grow started by mistake - "Grow starten" on an empty form makes one at once - is deleted from its menu by its
 * owner while nothing but the line of its phase stands in its diary. Its phases go first, each with its line, so no
 * line of a grow that is gone stays on its place's Start.
 */
describe('deleting a grow', () => {
  const diaryOf = (kinds: string[]) => ({
    items: [{ days: [{ entries: kinds.map((kind, index) => ({ id: `e${index}`, kind })) }] }],
    nextCursor: null,
    people: [],
    earlier: [],
  });
  const wire = (kinds: string[]) => {
    const asked: { method: string; path: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
        const method = init?.method ?? 'GET';
        asked.push({ method, path });
        if (method === 'DELETE') return new Response(null, { status: 204 });
        if (path === '/grows/grow-1/diary') return json(diaryOf(kinds));
        return json({ items: [], nextCursor: null });
      }),
    );
    return asked;
  };
  const drawMenu = (mayOwn = true) =>
    drawAt(
      <LogProvider>
        <Routes>
          <Route path="/grows/:growId" element={<GrowMenu grow={grow} plants={plants} spaces={[]} mayManage mayOwn={mayOwn} />} />
          <Route path="/grows" element={<h1>All grows</h1>} />
        </Routes>
      </LogProvider>,
      { at: '/grows/grow-1' },
    );
  const menu = () => fireEvent.click(screen.getByRole('button', { name: `More about ${grow.name}` }));

  afterEach(() => vi.unstubAllGlobals());

  it('is offered to the owner of a grow whose diary holds only its phases, asks, and goes to every grow after', async () => {
    const asked = wire(['phase', 'phase']);
    drawMenu();
    menu();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete grow' }));
    const sheet = screen.getByRole('dialog', { name: 'Delete grow' });
    expect(sheet).toHaveTextContent('Delete Spring run? The grow goes with its plants and the line of its phase. This cannot be undone.');
    expect(asked.filter(one => one.method === 'DELETE')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'All grows' })).toBeInTheDocument();
    expect(asked.filter(one => one.method === 'DELETE').map(one => one.path)).toEqual([
      '/grows/grow-1/phases/p2',
      '/grows/grow-1/phases/p1',
      '/grows/grow-1',
    ]);
    expect(await screen.findByText('Spring run deleted')).toBeInTheDocument();
  });

  it('is not offered where somebody wrote in the diary', async () => {
    const asked = wire(['phase', 'water']);
    drawMenu();
    await waitFor(() => expect(asked).toContainEqual({ method: 'GET', path: '/grows/grow-1/diary' }));
    // The answer is read before the menu is asked.
    await new Promise(resolve => setTimeout(resolve, 20));
    menu();
    expect(screen.queryByRole('button', { name: 'Delete grow' })).not.toBeInTheDocument();
  });

  it('is not offered to a reader who manages the grow without owning it', async () => {
    const asked = wire(['phase']);
    drawMenu(false);
    menu();
    expect(screen.queryByRole('button', { name: 'Delete grow' })).not.toBeInTheDocument();
    expect(asked.some(one => one.path === '/grows/grow-1/diary')).toBe(false);
  });
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
    drawAt(<GrowMenu grow={grow} plants={plants} spaces={[]} mayManage mayOwn={false} />);
    fireEvent.click(screen.getByRole('button', { name: `More about ${grow.name}` }));

    expect(screen.getByRole('button', { name: 'Name and type' })).toBeInTheDocument();
  });

  it('sends the trimmed name and the kind of plant, and nothing else: a rename moves nothing that was recorded', async () => {
    const asked: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({
          method: init?.method ?? 'GET',
          path: new URL(String(input), 'http://localhost').pathname,
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return json(grow);
      }),
    );

    drawAt(<RenameSheet grow={grow} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  Spring run, Amnesia  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const wrote = () => asked.filter(call => call.method !== 'GET');
    await waitFor(() => expect(wrote()).toHaveLength(1));
    expect(wrote()[0].method).toBe('PATCH');
    expect(wrote()[0].path).toBe('/v1/grows/grow-1');
    expect(wrote()[0].body).toEqual({ name: 'Spring run, Amnesia', type: grow.type });
  });

  /** The form a grow is started with asks only what cannot wait, so the kind of plant is said here. */
  it('says which kind of plant the grow is, which the form that started it did not ask', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') sent.push(JSON.parse(String(init.body)));
        return json(grow);
      }),
    );

    drawAt(<RenameSheet grow={grow} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Photoperiod' })).toHaveAttribute('aria-pressed', String(grow.type === 'photoperiod'));
    fireEvent.click(screen.getByRole('button', { name: 'Autoflower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent).toEqual([{ name: grow.name, type: 'autoflower' }]));
  });

  it('will not save an empty name, nor the one the grow already has', () => {
    drawAt(<RenameSheet grow={grow} onClose={() => {}} />);

    const save = screen.getByRole('button', { name: 'Save' });
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

/** The harvest sheet says through a toast that the grow has ended, so it stands inside the app's log. */
const drawHarvest = (sheet: React.ReactNode) => drawAt(<LogProvider>{sheet}</LogProvider>);

describe('the harvest sheet', () => {
  it('shares the total out over the plants named, before anything is sent', () => {
    drawHarvest(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Amnesia 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Amnesia 2' }));
    fireEvent.change(screen.getAllByPlaceholderText('—')[0], { target: { value: '420' } });

    expect(screen.getByText('420 g wet shared over 2 plants · about 210 g each.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Harvest 2 plants' })).toBeInTheDocument();
  });

  /** A weight that is no number, or below nothing, was sent as no weight at all: refused with a word, the harvest held back. */
  it('refuses a weight it cannot read by the field´s name, and harvests nothing until it is put right', () => {
    drawHarvest(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);
    const [wet, dry] = screen.getAllByPlaceholderText('—');

    fireEvent.change(wet, { target: { value: 'abc' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Wet: that is not a number.');
    expect(wet).toHaveAttribute('aria-invalid', 'true');
    expect(wet).toHaveAccessibleDescription('Wet: that is not a number.');
    expect(screen.getByRole('button', { name: /^Harvest/ })).toBeDisabled();

    fireEvent.change(wet, { target: { value: '420' } });
    fireEvent.change(dry, { target: { value: '-5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Dry: a weight is 0 g or more.');
    expect(dry).toHaveAttribute('aria-invalid', 'true');
    expect(wet).not.toHaveAttribute('aria-invalid');

    fireEvent.change(dry, { target: { value: '' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Harvest/ })).toBeEnabled();
  });

  it('says the grow ends before the last plants come down, and on which day', () => {
    drawHarvest(<HarvestSheet grow={grow} plants={plants} onClose={() => {}} />);

    // One line that says what the tap ends, and the rest behind its help: nothing is explained above the button.
    expect(screen.getByText(/^The grow ends on \d+ \w+ \d{4}\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end the grow/ })).toBeInTheDocument();
  });

  /** Every write answers: a plant cut while others still stand says which, and is taken back by its plants and its line. */
  it('answers a harvest that leaves the grow running with a toast naming the plants, and takes it back on Undo', async () => {
    const asked: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return init?.method === 'POST'
          ? json({
              plants: [{ ...plants[1], status: 'harvested', harvest: { harvestedAt: at(0), wetWeightG: null, dryWeightG: null } }],
              entryId: 'entry-9',
            })
          : json(plants[1]);
      }),
    );
    drawHarvest(<HarvestSheet grow={grow} plants={plants} preselect={['plant-2']} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Harvest 1 plant' }));
    expect(await screen.findByText(reading('Amnesia 2 harvested'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(asked.some(call => call.method === 'DELETE' && call.url.endsWith('/entries/entry-9'))).toBe(true));
    expect(asked.find(call => call.method === 'PATCH')).toMatchObject({
      url: expect.stringMatching(/\/plants\/plant-2$/),
      body: { status: 'active', harvest: null },
    });
    expect(await screen.findByText(reading('Undone · Amnesia 2 is standing again'))).toBeInTheDocument();
    expect(screen.queryByText('What was written')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('keeps a plant that has already come down on the list, dimmed and unpickable, with what it weighed', () => {
    const down = [
      plants[0],
      plants[1],
      plant('plant-3', 'Gelato 1', { status: 'harvested', harvest: { harvestedAt: at(1), wetWeightG: 90, dryWeightG: null } }),
    ];
    drawHarvest(<HarvestSheet grow={grow} plants={down} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Gelato 1' })).toBeDisabled();
    expect(screen.getByText(/wet 90 g/)).toBeInTheDocument();
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
    drawHarvest(<HarvestSheet grow={grow} plants={[]} onClose={() => {}} />);

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
        return json(grow);
      }),
    );

    drawHarvest(<HarvestSheet grow={grow} plants={[]} onClose={() => {}} />);
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
    // The grow is over: the toast says so, and that what is on screen now is its report.
    expect(await screen.findByText(reading('Spring run has ended · this is its report'))).toBeInTheDocument();
  });

  it('says when a grow that is already over ended, rather than offering to end it a second time', () => {
    drawHarvest(<HarvestSheet grow={{ ...grow, endedAt: at(2) }} plants={[]} onClose={() => {}} />);

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
    drawAt(
      <LogProvider>
        <SplitSheet grow={grow} plants={[]} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText(/No plants are recorded in this grow, so there is nothing here to split off/)).toBeInTheDocument();
    // Not the picker, not the phase or place chips, and no button that leads to
    // a refusal: the server wants at least one plant.
    expect(screen.queryByRole('button', { name: /Split off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep the phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Blue Dream tent' })).not.toBeInTheDocument();
  });

  it('is the whole sheet for a grow that does have plants', () => {
    drawAt(
      <LogProvider>
        <SplitSheet grow={grow} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByRole('button', { name: /Split off/ })).toBeInTheDocument();
    expect(screen.queryByText(/No plants are recorded/)).not.toBeInTheDocument();
  });

  /**
   * A split names no climate unless a preset is chosen, so its first chip is the phase sheet's "Leave as they are"
   * (Chris, 2026-11-13): it was called after the stage, "Flower", and wrote nothing.
   */
  it('offers the climates of the phase the plants go into behind "Leave as they are", and their places and none', () => {
    drawAt(
      <LogProvider>
        <SplitSheet grow={grow} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    const climates = screen.getByRole('group', { name: 'Climate preset' });
    expect(
      within(climates)
        .getAllByRole('button')
        .map(one => one.textContent),
    ).toEqual(['Leave as they are', 'Late flower', 'Auto · Flower']);
    expect(within(climates).getByRole('button', { name: 'Leave as they are' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Climate preset', { selector: '.label' })).toBeInTheDocument();
    // A stage nothing refines offers no choice at all: the lone chip would be no question.
    fireEvent.click(screen.getByRole('button', { name: 'Drying' }));
    expect(screen.queryByRole('group', { name: 'Climate preset' })).not.toBeInTheDocument();

    const places = screen.getByRole('group', { name: 'Their place' });
    expect(
      within(places)
        .getAllByRole('button')
        .map(one => one.textContent),
    ).toEqual(['Keep the place', 'Blue Dream tent', 'No fixed place']);
  });
});

/** A move and a split answer with what holds now; neither is one call to take back, so neither offers a way back. */
describe('the answer of a move and a split', () => {
  const tent = spaceWhere('own', { name: 'Blue Dream tent' });
  const other = spaceWhere('own', { id: 'space-2', name: 'Second tent' });
  const wire = () => {
    const sent: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
        sent.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : null });
        return json({ id: 'answer' });
      }),
    );
    return sent;
  };

  afterEach(() => vi.unstubAllGlobals());

  it('says where the grow stands after a move', async () => {
    const sent = wire();
    drawAt(
      <LogProvider>
        <MoveSheet grow={grow} plants={plants} spaces={[tent, other]} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move · Second tent' }));
    expect(await screen.findByText(reading('Spring run · new place: Second tent'))).toBeInTheDocument();
    expect(sent.find(one => one.method === 'POST')).toMatchObject({ path: '/grows/grow-1/placements', body: { spaceId: 'space-2' } });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says how many plants went their own way, and into what', async () => {
    wire();
    drawAt(
      <LogProvider>
        <SplitSheet grow={grow} plants={plants} spaces={[tent, other]} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gelato 1' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Their place' })).getByRole('button', { name: 'Second tent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Split off 1 plant' }));
    expect(await screen.findByText(reading('1 plant goes its own way · Second tent'))).toBeInTheDocument();
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
    drawAt(
      <LogProvider>
        <MoveSheet grow={finished} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText('last place: Blue Dream tent')).toBeInTheDocument();
    expect(screen.queryByText('Place now: No fixed place')).not.toBeInTheDocument();
  });

  it('still says in the present where a running grow stands', () => {
    drawAt(
      <LogProvider>
        <MoveSheet grow={grow} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText('Place now: Blue Dream tent')).toBeInTheDocument();
  });

  it('offers no move of its own, only the rows of where it stood', () => {
    drawAt(
      <LogProvider>
        <MoveSheet grow={finished} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.queryByRole('button', { name: /^Move · / })).not.toBeInTheDocument();
    expect(screen.getByText(/This grow has ended, so it does not move any more/)).toBeInTheDocument();
  });

  it('is offered a phase, a move and a new name, but no split, no harvest and no tips for a stage it is no longer in', () => {
    drawAt(<GrowMenu grow={finished} plants={plants} spaces={[tent]} mayManage mayOwn={false} />);
    const menu = screen.getByRole('button', { name: `More about ${finished.name}` });
    fireEvent.click(menu);

    const offered = within(document.getElementById(menu.getAttribute('aria-controls')!)!)
      .getAllByRole('button')
      .map(button => button.textContent);
    expect(offered).toEqual(['Phase', 'Move', 'Name and type']);
  });

  /** "No fixed place" is a place a grow can be in, and a running grow that is in it says so. */
  it('says a running grow stands in no fixed place where that is what it does', () => {
    drawAt(
      <LogProvider>
        <MoveSheet grow={{ ...grow, summary: { ...grow.summary, locations: [] } }} plants={plants} spaces={[tent]} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText('Place now: No fixed place')).toBeInTheDocument();
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
    drawAt(
      <LogProvider>
        <PhaseSheet grow={finished} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText('Ended in Flower on day 35 of the grow · 18 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText(/^Now /)).not.toBeInTheDocument();
    // A grow that is over is in no stage, so no stage is marked as the one it is in.
    expect(screen.queryByRole('button', { name: /· now/ })).not.toBeInTheDocument();
  });

  it('keeps the phase list repairable, worded as a record rather than a move, dated to the day it ended', () => {
    drawAt(
      <LogProvider>
        <PhaseSheet grow={finished} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByRole('button', { name: 'Record Drying' })).toBeEnabled();
    // Not today: a phase filed a month after the plants came down would be a
    // stage the grow never stood in.
    expect(screen.getByLabelText('On')).toHaveValue('2026-09-18');
  });

  /** A phase some plants were split into is theirs: listed as the grow's, it said the whole grow had gone back to Veg. */
  it('names the plants a split phase is of among the phases so far', () => {
    const client = testClient();
    client.setQueryData(['grow', 'grow-1', 'plants'], { items: plants, nextCursor: null });
    const split = { ...phase('p3', 'vegetative', 5), plantIds: ['plant-3'] };
    drawAt(
      <LogProvider>
        <PhaseSheet grow={{ ...grow, phases: [...grow.phases, split] }} onClose={() => {}} />
      </LogProvider>,
      { client },
    );

    expect(screen.getByText('Veg · for Gelato 1')).toBeInTheDocument();
  });

  it('speaks in the present over a grow that is still running, which is what the ended wording is told against', () => {
    drawAt(
      <LogProvider>
        <PhaseSheet grow={grow} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.getByText('Now Flower · day 11 of the phase · day 35, week 5 of the grow')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter Drying' })).toBeInTheDocument();
  });
});

const standing = (over: Partial<Device> = {}): Device =>
  deviceWith({
    createdAt: at(60),
    name: 'Blue Dream controller',
    configuration: { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 } },
    state: {
      lastSeenAt: at(0),
      claimedAt: at(60),
      firmwareId: 'build-1',
      // With the sensor, which is what makes the preset's CO2 row one that is
      // written at all: a controller reporting none holds its target at zero.
      hardware: { co2: 'on' },
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
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    const choices = screen.getByRole('group', { name: 'Targets' });
    expect(within(choices).getByRole('button', { name: 'Leave as they are' })).toHaveAttribute('aria-pressed', 'true');
    // The climates of the stage, by the names the chips under Control carry.
    expect(within(choices).getByRole('button', { name: 'Flower' })).toBeInTheDocument();
    expect(within(choices).getByRole('button', { name: 'Late flower' })).toBeInTheDocument();
    expect(within(choices).getByRole('button', { name: 'Auto · Flower' })).toBeInTheDocument();
    // Eighteen hours from six in the morning: said as the window it makes, which ends at midnight.
    expect(screen.getByText(reading('Stay: Light on 06:00–00:00 · 18 h · day 26 °C · night 22 °C · 62 %'))).toBeInTheDocument();
  });

  it('puts the tent on the stage´s own climate with the phase when that is chosen, and says what it sets', async () => {
    const asked: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
        return json(phase('p3', 'flowering', 0));
      }),
    );
    hardware.devices = [tent()];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Flower' }));
    // A preset moves how long the light is on, never when it comes on: twelve hours from the device's six.
    expect(screen.getByText(reading('New: Light on 06:00–18:00 · 12 h · day 25 °C · night 20 °C · 50 %'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter Flower' }));

    await waitFor(() => expect(asked.filter(call => call.method === 'POST')).toHaveLength(1));
    expect(asked.find(call => call.method === 'POST')?.body).toMatchObject({ stage: 'flowering', preset: null, climate: true });
  });

  /** Every write of the grow's menu answers: a phase begun says so, with the way back where taking it back is all it did. */
  it('answers a phase entered as a record with the way back, and one that set the targets without one', async () => {
    const asked: { method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', url: String(input) });
        return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(phase('p3', 'flowering', 0));
      }),
    );
    hardware.devices = [tent()];
    const { unmount } = drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enter Flower' }));
    expect(await screen.findByText(reading('Entered Flower · Spring run'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(asked.some(call => call.method === 'DELETE' && call.url.endsWith('/grows/grow-1/phases/p3'))).toBe(true));
    unmount();

    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );
    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Flower' }));
    expect(await screen.findByText(reading('Entered Flower · Spring run · targets set'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  /**
   * Taking a phase back writes no device. A tent left drying under a grow that then read "Flower" was told nothing
   * and showed "All on target": the question says what the device holds, and that it goes on drying, with the way to
   * where drying is ended.
   */
  it('says, before a phase is taken back, what the device goes on holding, and leads to where drying is ended', () => {
    const drying: GrowListItem = {
      ...grow,
      phases: [phase('p1', 'flowering', 20), phase('p2', 'drying', 2)],
      summary: { ...grow.summary, stage: 'drying' },
    };
    hardware.devices = [{ ...tent(), control: { running: true, drying: true, mode: 'standard', energySaving: false } }];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={drying} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' })[1]);
    expect(screen.getByText('The grow then shows Flower instead of Drying.')).toBeInTheDocument();
    expect(
      screen.getByText(
        reading(
          /^Nothing changes on the device – it goes on holding: light off · 22 °C · 58 %\. So it goes on drying until you end drying under Control\./,
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'End drying ›' })).toHaveAttribute('href', '/control?space=space-1');
  });

  it('says what a lit device goes on holding where a phase is taken back, and leads nowhere it need not', () => {
    const flowering: GrowListItem = {
      ...grow,
      phases: [phase('p1', 'vegetative', 20), phase('p2', 'flowering', 2)],
      summary: { ...grow.summary, stage: 'flowering' },
    };
    hardware.devices = [tent()];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={flowering} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' })[1]);
    expect(screen.getByText(reading(/^Nothing changes on the device – it goes on holding: Light on 06:00–00:00 · 18 h · /))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^End / })).not.toBeInTheDocument();
  });

  /** The stage and the climate it was entered on can carry the same word: both rows are named. */
  it('names both rows where a phase is corrected, and answers the correction with the phase as it stood', async () => {
    const asked: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        asked.push({ method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
        return json(phase('p1', 'flowering', 20));
      }),
    );
    const flowering: GrowListItem = { ...grow, phases: [phase('p1', 'flowering', 20)], summary: { ...grow.summary, stage: 'flowering' } };
    hardware.devices = [tent()];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={flowering} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Correct' }));
    expect(screen.getAllByText('Phase', { selector: '.label' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Climate preset', { selector: '.label' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Climate preset' })).getByRole('button', { name: 'Late flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the correction' }));

    expect(await screen.findByText(reading(/^Phase corrected · Flower · .+ from \d+ \w+ 2026$/))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(asked.filter(call => call.method === 'PATCH')).toHaveLength(2));
    expect(asked.filter(call => call.method === 'PATCH')[1].body).toMatchObject({ stage: 'flowering', preset: null });
  });

  /**
   * Drying with the targets left as they are named a light window, a day and a
   * night the device was about to stop having, and the day's humidity it would
   * not hold.
   */
  it('keeps the light where drying is only recorded, and says what its climate holds: the dark, and nothing of a day', () => {
    hardware.devices = [tent()];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Drying' }));
    // A phase without its climate is a record: the tent keeps its light, as the chip says.
    expect(screen.getByText(reading(/^Stay: Light on 06:00/))).toBeInTheDocument();
    expect(screen.queryByText(reading(/light off/))).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Drying' }));
    expect(screen.getByText(reading('New: light off · 18 °C · 58 %'))).toBeInTheDocument();
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
        return json(phase('p3', 'germination', 0));
      }),
    );
    hardware.devices = [{ ...tent(), type: 'fridge', control: { running: true, drying: false, mode: 'standard', energySaving: false } }];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    // The stage chip records the stage and is called by it; the one choice that darkens is the climate beside it.
    expect(screen.queryAllByRole('button', { name: 'Germination · dark' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Germination' }));
    // Only recorded, the light stays as it is.
    expect(screen.getByText(reading(/^Stay: Light on 06:00–00:00 · 18 h · /))).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Germination · dark' }));
    expect(screen.getByText(reading('New: light off · 24 °C · 75 %'))).toBeInTheDocument();
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
        return json(answer);
      }),
    );
    hardware.devices = [{ ...tent(), type: 'fridge', control: { running: true, drying: false, mode: 'standard', energySaving: false } }];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Germination' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Targets' })).getByRole('button', { name: 'Germination · dark' }));
    const choices = screen.getByRole('group', { name: 'During germination' });
    const humidifier = await within(choices).findByRole('switch', { name: 'Hold the humidity with the humidifier' });
    expect(humidifier).toHaveAttribute('aria-checked', 'true');
    expect(within(choices).getByText(/^The humidifier holds \d+ % – it never makes it wetter than that\.$/)).toBeInTheDocument();

    fireEvent.click(humidifier);
    fireEvent.click(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' }));
    expect(within(choices).getByText('The humidifier rests until germination ends.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter Germination' }));

    await waitFor(() => expect(asked.filter(call => call.method === 'POST')).toHaveLength(1));
    expect(asked.find(call => call.method === 'POST')?.body).toMatchObject({
      stage: 'germination',
      climate: true,
      germinationChoices: { warnTooHumid: true, humidifierHolds: false },
    });
  });

  it('offers the seedling´s climate first while the device germinates, and says the light comes back only with it', () => {
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
    drawAt(
      <LogProvider>
        <PhaseSheet grow={germinating} onClose={() => {}} />
      </LogProvider>,
    );

    const choices = screen.getByRole('group', { name: 'Targets' });
    expect(within(choices).getByRole('button', { name: 'Seedling · with light' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(reading('New: Light on 06:00–00:00 · 18 h · day 24 °C · night 21 °C · 70 %'))).toBeInTheDocument();

    // Left as they are, nothing is written: the device goes on germinating in the dark, and the sheet says so.
    fireEvent.click(within(choices).getByRole('button', { name: 'Leave as they are' }));
    expect(screen.getByText(reading(/^Stay: light off · /))).toBeInTheDocument();
  });

  it('is not asked where nothing standing there states a climate', () => {
    hardware.devices = [];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    expect(screen.queryByRole('group', { name: 'Targets' })).not.toBeInTheDocument();
  });

  it('says curing has no climate rather than offering one', () => {
    hardware.devices = [tent()];
    drawAt(
      <LogProvider>
        <PhaseSheet grow={veg} onClose={() => {}} />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Curing' }));
    expect(screen.queryByRole('group', { name: 'Targets' })).not.toBeInTheDocument();
    expect(screen.getByText(/Curing has no climate of its own/)).toBeInTheDocument();
  });
});
