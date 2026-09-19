import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from '@common/v1/access.guard';
import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { AppliedPreset, ClimatePresets } from '@modules/v1/grow/climate-presets.port';
import { NOTHING_HIDDEN, summaryOf } from '@modules/v1/grow/grow-serialiser';
import { GrowsController } from '@modules/v1/grow/grows.controller';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { PlantsController } from '@modules/v1/grow/plants.controller';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Grows: what the model implies and who is allowed to say it.
 *
 * Two halves, because two things can go wrong. The day counter, the phase a
 * plant stands in and where it stands are worked out in one serialiser that
 * every screen reads through, so they are checked as arithmetic against fixed
 * dates rather than through a route. Who may do what is checked through the real
 * guard on the real handler: a route that forgot to say what it needs would
 * still answer, and that is a hole rather than a wrong number.
 */

const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const TENT = 'space-tent';
const FRIDGE = 'space-fridge';
const GROW = 'grow-1';
const DEVICE = 'device-1';

const STARTED_AT = new Date('2026-05-01T08:00:00.000Z');
const TEN_DAYS_LATER = new Date('2026-05-11T09:00:00.000Z');

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };

let db: V1TestDatabase;
let access: AccessService;
let entries: EntryWriterService;
let grows: GrowsService;
let applied: { spaceId: string; stage: string; preset: string }[];

/** Stands in for the space slice, which owns the preset table and writes it to the controllers of a space. */
const presets: ClimatePresets = {
  applyToSpace: async (spaceId, stage, preset): Promise<AppliedPreset[]> => {
    applied.push({ spaceId, stage, preset });
    return [{ deviceId: DEVICE, targets: { day: { temperature: 26, humidity: 65 }, night: { temperature: 22, humidity: 70 }, co2: null } }];
  },
};

const build = (presetsPort: ClimatePresets | null): GrowsService => {
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  entries = new EntryWriterService(db.entries);

  return new GrowsService(
    db.grows,
    db.plants,
    db.devices,
    db.memberships,
    db.spaces,
    db.users,
    db.shareLinks,
    access,
    new PhaseWriterService(db.grows, entries),
    entries,
    presetsPort,
  );
};

/** One tent inside a room, a fridge beside it, a controller in the tent, and the four kinds of caller. */
const world = async (): Promise<void> => {
  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null },
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: ROOM },
    { id: FRIDGE, ownerId: OWNER, kind: 'fridge', name: 'The fridge', roomId: ROOM },
  ]);

  await db.devices.create({
    id: DEVICE,
    type: 'controller',
    ownerId: OWNER,
    spaceId: TENT,
    configuration: { day: { temperature: 24 }, night: { temperature: 20 } },
  });

  await db.memberships.create([
    { id: 'membership-manager', spaceId: ROOM, userId: MANAGER, role: 'can_manage' },
    { id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_log' },
  ]);

  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: MANAGER, email: 'manager@test.invalid', handle: 'manager', passwordHash: 'x' },
  ]);
};

const plantsOfGrow = (growId = GROW): Promise<PlantDocument[]> => grows.plantsOf(growId);

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  applied = [];
  grows = build(presets);
  await world();
});

// ---------------------------------------------------------------------------
// What the two lists mean
// ---------------------------------------------------------------------------

type Phase = GrowDocument['phases'][number];
type Placement = GrowDocument['placements'][number];

const phase = (over: Partial<Phase>): Phase => ({
  id: 'phase',
  stage: 'vegetative',
  preset: null,
  startedAt: STARTED_AT,
  source: 'human',
  plantIds: null,
  deviceId: null,
  targets: null,
  setBy: OWNER,
  ...over,
});

const placement = (over: Partial<Placement>): Placement => ({
  id: 'placement',
  spaceId: TENT,
  startedAt: STARTED_AT,
  endedAt: null,
  plantIds: null,
  ...over,
});

const grown = (over: Partial<GrowDocument>): GrowDocument =>
  ({
    id: GROW,
    ownerId: OWNER,
    name: 'Spring run',
    type: 'photoperiod',
    phases: [],
    placements: [],
    endedAt: null,
    startedAt: STARTED_AT,
    ...over,
  }) as GrowDocument;

const planted = (...ids: string[]): PlantDocument[] => ids.map(id => ({ id }) as PlantDocument);

describe('what a grow´s phases and placements mean', () => {
  it('counts day 1 on the day the first phase started', () => {
    const summary = summaryOf(grown({ phases: [phase({})] }), planted('a'), NOTHING_HIDDEN, STARTED_AT);

    expect(summary.dayNumber).toBe(1);
    expect(summary.weekNumber).toBe(1);
    expect(summary.phaseDay).toBe(1);
  });

  it('counts the days that have passed, and the week with them', () => {
    const summary = summaryOf(grown({ phases: [phase({})] }), planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.dayNumber).toBe(11);
    expect(summary.weekNumber).toBe(2);
  });

  it('counts from the first phase and not from the day the grow was written down', () => {
    const later = new Date('2026-05-06T08:00:00.000Z');
    const summary = summaryOf(grown({ startedAt: STARTED_AT, phases: [phase({ startedAt: later })] }), planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.dayNumber).toBe(6);
  });

  it('counts nothing before the grow has entered a phase', () => {
    const summary = summaryOf(grown({ placements: [placement({})] }), planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary).toMatchObject({ dayNumber: null, weekNumber: null, stage: null, phaseDay: null, isAuto: false, groups: [] });
  });

  it('stops counting on the day the grow ended', () => {
    const endedAt = new Date('2026-05-06T08:00:00.000Z');
    const summary = summaryOf(grown({ phases: [phase({})], endedAt }), planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.dayNumber).toBe(6);
  });

  it('is auto when a preset or the plan put the grow there, and not when a person did', () => {
    const byPreset = summaryOf(grown({ phases: [phase({ source: 'preset' })] }), planted('a'), NOTHING_HIDDEN, STARTED_AT);
    const byHand = summaryOf(grown({ phases: [phase({})] }), planted('a'), NOTHING_HIDDEN, STARTED_AT);

    expect(byPreset.isAuto).toBe(true);
    expect(byHand.isAuto).toBe(false);
  });

  it('lists no groups while every plant is in the same phase', () => {
    const summary = summaryOf(grown({ phases: [phase({})] }), planted('a', 'b', 'c'), NOTHING_HIDDEN, STARTED_AT);

    expect(summary.groups).toEqual([]);
    expect(summary.stage).toBe('vegetative');
  });

  it('lists every group once a split has scoped one, and takes the headline from the largest', () => {
    const drying = phase({ id: 'phase-drying', stage: 'drying', startedAt: TEN_DAYS_LATER, plantIds: ['c'] });
    const summary = summaryOf(grown({ phases: [phase({ id: 'phase-veg' }), drying] }), planted('a', 'b', 'c'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.stage).toBe('vegetative');
    expect(summary.groups).toEqual([
      { stage: 'vegetative', preset: null, phaseDay: 11, plantIds: ['a', 'b'] },
      { stage: 'drying', preset: null, phaseDay: 1, plantIds: ['c'] },
    ]);
  });

  it('says where each plant stands, from the open placements', () => {
    const moved = placement({ id: 'placement-fridge', spaceId: FRIDGE, startedAt: TEN_DAYS_LATER, plantIds: ['c'] });
    const summary = summaryOf(grown({ placements: [placement({}), moved] }), planted('a', 'b', 'c'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.locations).toEqual([
      { spaceId: TENT, plantIds: ['a', 'b'] },
      { spaceId: FRIDGE, plantIds: ['c'] },
    ]);
  });

  it('still says where a grow with no plants of its own stands', () => {
    const summary = summaryOf(grown({ placements: [placement({})] }), [], NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.locations).toEqual([{ spaceId: TENT, plantIds: [] }]);
  });

  it('forgets a placement that has been closed', () => {
    const left = placement({ endedAt: TEN_DAYS_LATER });
    const summary = summaryOf(grown({ placements: [left] }), planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);

    expect(summary.locations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The new-grow sheet
// ---------------------------------------------------------------------------

const started = (over: Record<string, unknown> = {}) =>
  grows.create(session(OWNER), {
    name: 'Spring run #3',
    type: 'photoperiod',
    plants: [
      { strain: 'Amnesia', count: 2 },
      { strain: 'Gelato', count: 1 },
    ],
    spaceId: TENT,
    startedAt: STARTED_AT.toISOString(),
    ...over,
  });

describe('starting a grow', () => {
  it('makes one plant per plant, numbered within its strain', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    expect(plants.map(plant => plant.label)).toEqual(['Amnesia 1', 'Amnesia 2', 'Gelato 1']);
    expect(plants.every(plant => plant.status === 'active')).toBe(true);
  });

  it('stands the grow where the sheet put it', async () => {
    const grow = await started();

    expect(grow.placements).toHaveLength(1);
    expect(grow.placements[0]).toMatchObject({ spaceId: TENT, endedAt: null, plantIds: null });
    expect(grow.summary.locations[0].spaceId).toBe(TENT);
  });

  it('gives a grow with no fixed place a placement all the same', async () => {
    const grow = await started({ spaceId: null });

    expect(grow.placements[0].spaceId).toBeNull();
    expect(grow.summary.locations).toEqual([{ spaceId: null, plantIds: grow.summary.locations[0].plantIds }]);
  });

  it('counts no day until the grow has entered a phase', async () => {
    const grow = await started();

    expect(grow.summary.dayNumber).toBeNull();
    expect(grow.phases).toEqual([]);
  });

  it('gives the grow an address made from its name', async () => {
    expect((await started()).slug).toBe('spring-run-3');
  });

  it('gives a second grow of the same name an address of its own', async () => {
    const first = await started();
    const second = await started();

    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith('spring-run-3-')).toBe(true);
  });

  it('starts private, because making it public is a decision of its own', async () => {
    expect((await started()).visibility).toBe('private');
  });

  it('refuses a demo session, which is nobody', async () => {
    await expect(grows.create(demo, { name: 'A tour´s grow', type: 'photoperiod', plants: [] })).rejects.toThrow(ProblemException);
  });

  it('refuses a space the caller may not manage', async () => {
    await expect(grows.create(session(MEMBER), { name: 'x', type: 'photoperiod', plants: [], spaceId: TENT })).rejects.toThrow(ProblemException);
  });
});

// ---------------------------------------------------------------------------
// Phases and moves
// ---------------------------------------------------------------------------

describe('entering a phase', () => {
  it('puts the controllers of the space on the preset, and marks the phase as theirs', async () => {
    const grow = await started();
    const written = await grows.addPhase(grow.id, { stage: 'seedling', preset: 'early_seedling' }, OWNER, NOTHING_HIDDEN);

    expect(applied).toEqual([{ spaceId: TENT, stage: 'seedling', preset: 'early_seedling' }]);
    expect(written).toMatchObject({ source: 'preset', deviceId: DEVICE, setBy: null });
    expect(written.targets?.day.temperature).toBe(26);
  });

  it('is set by the person who picked it when no preset came with it', async () => {
    const grow = await started();
    const written = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    expect(applied).toEqual([]);
    expect(written).toMatchObject({ source: 'human', setBy: OWNER });
  });

  it('snapshots what the controller runs even when nobody applied a preset', async () => {
    const grow = await started();
    const written = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    expect(written.deviceId).toBe(DEVICE);
    expect(written.targets).toMatchObject({ day: { temperature: 24 }, night: { temperature: 20 } });
  });

  it('writes the phase on the timeline', async () => {
    const grow = await started();
    await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    const written = await db.entries.find({ growId: grow.id, kind: 'phase' }).lean();
    expect(written).toHaveLength(1);
  });

  it('appends nothing for the phase the grow already stands in', async () => {
    const grow = await started();
    const first = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);
    const again = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    expect(again.id).toBe(first.id);
    expect((await grows.read(grow.id, NOTHING_HIDDEN)).phases).toHaveLength(1);
  });

  it('refuses a plant that belongs to another grow', async () => {
    const grow = await started();
    await expect(grows.addPhase(grow.id, { stage: 'drying', plantIds: ['plant-elsewhere'] }, OWNER, NOTHING_HIDDEN)).rejects.toThrow(
      ProblemException,
    );
  });

  it('applies no preset where the grow stands nowhere', async () => {
    const grow = await started({ spaceId: null });
    const written = await grows.addPhase(grow.id, { stage: 'seedling', preset: 'early_seedling' }, OWNER, NOTHING_HIDDEN);

    expect(applied).toEqual([]);
    expect(written).toMatchObject({ source: 'human', deviceId: null, targets: null });
  });
});

describe('moving plants', () => {
  it('closes the placement it replaces and opens the new one', async () => {
    const grow = await started();
    await grows.addPlacement(session(OWNER), grow.id, { spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    const moved = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(moved.placements.filter(row => row.endedAt === null)).toHaveLength(1);
    expect(moved.summary.locations.map(row => row.spaceId)).toEqual([FRIDGE]);
  });

  it('leaves the plants that did not move where they were', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.addPlacement(session(OWNER), grow.id, { spaceId: FRIDGE, plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);

    const moved = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(moved.summary.locations).toEqual([
      { spaceId: TENT, plantIds: [plants[1].id, plants[2].id] },
      { spaceId: FRIDGE, plantIds: [plants[0].id] },
    ]);
  });

  it('writes the move on the timeline', async () => {
    const grow = await started();
    await grows.addPlacement(session(OWNER), grow.id, { spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    const written = await db.entries.find({ growId: grow.id, kind: 'move' }).lean();
    expect(written).toHaveLength(1);
    expect(written[0].values).toMatchObject({ kind: 'move', spaceId: FRIDGE });
  });

  it('refuses a space the caller may not manage', async () => {
    const grow = await started();
    await expect(grows.addPlacement(session(MEMBER), grow.id, { spaceId: FRIDGE }, MEMBER, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });
});

describe('plants', () => {
  it('takes the next free number of the strain when no label is given', async () => {
    const grow = await started();
    const added = await grows.addPlant(grow.id, { strain: 'Amnesia' }, NOTHING_HIDDEN);

    expect(added.label).toBe('Amnesia 3');
  });

  it('records what a plant weighed, days after it was cut', async () => {
    const grow = await started();
    const plant = (await plantsOfGrow(grow.id))[0];

    const harvested = await grows.updatePlant(
      plant.id,
      { status: 'harvested', harvest: { harvestedAt: TEN_DAYS_LATER.toISOString(), wetWeightG: 120, dryWeightG: null } },
      NOTHING_HIDDEN,
    );

    expect(harvested).toMatchObject({ status: 'harvested', harvest: { wetWeightG: 120, dryWeightG: null } });
  });

  it('goes with the grow when the grow is deleted', async () => {
    const grow = await started();
    await grows.remove(grow.id);

    expect(await plantsOfGrow(grow.id)).toEqual([]);
    await expect(grows.read(grow.id, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });
});

// ---------------------------------------------------------------------------
// What a reader who is not one of the household is told
// ---------------------------------------------------------------------------

describe('what is left out for a stranger', () => {
  const hidden = { weights: true, counts: true, authors: true };

  it('hides the weights', async () => {
    const grow = await started();
    const plant = (await plantsOfGrow(grow.id))[0];
    await grows.updatePlant(plant.id, { harvest: { harvestedAt: TEN_DAYS_LATER.toISOString(), wetWeightG: 120, dryWeightG: 30 } }, NOTHING_HIDDEN);

    const page = await grows.listPlants(grow.id, { weights: true, counts: false, authors: true });
    expect(page.items[0].harvest).toMatchObject({ wetWeightG: null, dryWeightG: null });
  });

  it('answers no plants at all where the count is hidden, rather than a shorter list', async () => {
    const grow = await started();

    expect((await grows.listPlants(grow.id, hidden)).items).toEqual([]);
  });

  it('empties the scopes that would state the count again', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.addPhase(grow.id, { stage: 'drying', plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);

    const read = await grows.read(grow.id, hidden);
    expect(read.phases[0].plantIds).toEqual([]);
    expect(read.summary.locations.every(row => row.plantIds.length === 0)).toBe(true);
  });

  it('tells the owner everything', async () => {
    const grow = await started();

    expect((await grows.listPlants(grow.id, NOTHING_HIDDEN)).items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe('the grows a caller is shown', () => {
  beforeEach(() => started());

  it.each([
    ['its owner', 1, OWNER],
    ['somebody who may manage the room it stands in', 1, MANAGER],
    ['somebody who may log in the tent', 1, MEMBER],
    ['a stranger', 0, STRANGER],
  ])('shows %s %i of them', async (_who, count, userId) => {
    expect((await grows.list(session(userId), {})).items).toHaveLength(count);
  });

  it('shows a demo session the demo grows and no others', async () => {
    expect((await grows.list(demo, {})).items).toHaveLength(0);

    await db.grows.updateMany({}, { isDemo: true });
    expect((await grows.list(demo, {})).items).toHaveLength(1);
  });

  it('filters by the space a grow stands in', async () => {
    expect((await grows.list(session(OWNER), {}, TENT)).items).toHaveLength(1);
    expect((await grows.list(session(OWNER), {}, FRIDGE)).items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The access matrix
// ---------------------------------------------------------------------------

/**
 * Every route that names its subject in the path, asked of every kind of
 * caller - through the guard that decides it, on the handler the router would
 * have called. A route that forgot to declare what it needs lets everybody
 * through here, which is the mistake worth catching: a wrong need is a bug, a
 * missing one is a hole.
 */
const ROUTES = {
  'GET /grows/{id}': GrowsController.prototype.read,
  'PATCH /grows/{id}': GrowsController.prototype.update,
  'DELETE /grows/{id}': GrowsController.prototype.remove,
  'GET /grows/{id}/plants': GrowsController.prototype.plants,
  'POST /grows/{id}/plants': GrowsController.prototype.addPlant,
  'POST /grows/{id}/phases': GrowsController.prototype.addPhase,
  'POST /grows/{id}/placements': GrowsController.prototype.addPlacement,
  'PATCH /plants/{id}': PlantsController.prototype.update,
  'DELETE /plants/{id}': PlantsController.prototype.remove,
} as const;

const READS = ['GET /grows/{id}', 'GET /grows/{id}/plants'];
const EVERYTHING = Object.keys(ROUTES);
const NOTHING: string[] = [];

const contextFor = (handler: unknown, controller: object, id: string, ctx: AccessContext): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => controller.constructor,
    switchToHttp: () => ({
      getRequest: () => ({ params: { id }, headers: {}, query: {}, auth: { userId: ctx.userId, isAdmin: ctx.isAdmin, isDemo: ctx.isDemo } }),
    }),
  }) as unknown as ExecutionContext;

const allowedRoutes = async (ctx: AccessContext, plantId: string): Promise<string[]> => {
  const guard = new AccessGuard(new Reflector(), access);
  const allowed: string[] = [];

  for (const [route, handler] of Object.entries(ROUTES)) {
    const controller = route.includes('/plants/{id}') ? PlantsController.prototype : GrowsController.prototype;
    try {
      await guard.canActivate(contextFor(handler, controller, route.includes('/plants/{id}') ? plantId : GROW, ctx));
      allowed.push(route);
    } catch (error) {
      if (!(error instanceof ProblemException)) throw error;
    }
  }

  return allowed;
};

describe('who may do what to a grow', () => {
  let plantId: string;

  beforeEach(async () => {
    await db.grows.create({
      id: GROW,
      ownerId: OWNER,
      name: 'The grow',
      type: 'photoperiod',
      slug: 'the-grow',
      placements: [{ id: 'placement-1', spaceId: TENT, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      startedAt: STARTED_AT,
    });

    const plant = await db.plants.create({ id: 'plant-1', growId: GROW, strain: 'Amnesia', label: 'Amnesia 1' });
    plantId = plant.id;
  });

  it('lets the owner do all of it', async () => {
    expect(await allowedRoutes(session(OWNER), plantId)).toEqual(EVERYTHING);
  });

  it('lets somebody who may manage do everything but delete the grow', async () => {
    expect(await allowedRoutes(session(MANAGER), plantId)).toEqual(EVERYTHING.filter(route => route !== 'DELETE /grows/{id}'));
  });

  it('lets somebody who may log read it and change nothing', async () => {
    expect(await allowedRoutes(session(MEMBER), plantId)).toEqual(READS);
  });

  it('tells a stranger nothing', async () => {
    expect(await allowedRoutes(session(STRANGER), plantId)).toEqual(NOTHING);
  });

  it('tells a demo session nothing about a grow that is not part of the tour', async () => {
    expect(await allowedRoutes(demo, plantId)).toEqual(NOTHING);
  });

  it('lets a demo session read a grow that is part of the tour, and write none of it', async () => {
    await db.grows.updateOne({ id: GROW }, { isDemo: true });

    expect(await allowedRoutes(demo, plantId)).toEqual(READS);
  });

  it('says a grow a caller may not see is not there, rather than that they may not see it', async () => {
    const refusal = await allowedRefusal(session(STRANGER), GrowsController.prototype.read);

    expect(refusal.problem.status).toBe(404);
    expect(refusal.problem.code).toBe('grow_not_found');
  });

  it('admits a grow exists to somebody who may read it but not change it', async () => {
    const refusal = await allowedRefusal(session(MEMBER), GrowsController.prototype.update);

    expect(refusal.problem.status).toBe(403);
    expect(refusal.problem.code).toBe('insufficient_access');
  });
});

const allowedRefusal = async (ctx: AccessContext, handler: unknown): Promise<ProblemException> => {
  const guard = new AccessGuard(new Reflector(), access);

  try {
    await guard.canActivate(contextFor(handler, GrowsController.prototype, GROW, ctx));
  } catch (error) {
    return error as ProblemException;
  }

  throw new Error('The request was allowed.');
};
