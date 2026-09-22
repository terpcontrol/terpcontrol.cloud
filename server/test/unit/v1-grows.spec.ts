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
import { NOTHING_HIDDEN, growUpTo, serialiseGrow, summaryOf } from '@modules/v1/grow/grow-serialiser';
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
    db.entries,
    access,
    new PhaseWriterService(db.grows, entries, db.entries, db.devices),
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

  /**
   * What a reader whose window closed is told about the grow as a whole. The
   * day counter and the headline are worked out from the phases and the end,
   * so a grow read through a window that closed a month ago would otherwise
   * answer today's day number and a stage entered long after the link was sent.
   */
  describe('a grow read up to an instant', () => {
    const FIVE_DAYS_IN = new Date('2026-05-06T08:00:00.000Z');
    const running = grown({
      phases: [phase({ id: 'phase-veg' }), phase({ id: 'phase-flower', stage: 'flowering', startedAt: new Date('2026-05-09T08:00:00.000Z') })],
      placements: [placement({}), placement({ id: 'placement-fridge', spaceId: 'space-fridge', startedAt: new Date('2026-05-09T08:00:00.000Z') })],
      endedAt: new Date('2026-05-10T08:00:00.000Z'),
    });

    it('stops the day counter and the headline where the window did', () => {
      const whole = summaryOf(running, planted('a'), NOTHING_HIDDEN, TEN_DAYS_LATER);
      const seen = summaryOf(growUpTo(running, FIVE_DAYS_IN), planted('a'), NOTHING_HIDDEN, FIVE_DAYS_IN);

      expect(whole).toMatchObject({ dayNumber: 10, stage: 'flowering' });
      expect(seen).toMatchObject({ dayNumber: 6, stage: 'vegetative' });
    });

    it('has not ended, because a grow that ended after the window is still running as far as that reader knows', () => {
      expect(growUpTo(running, FIVE_DAYS_IN).endedAt).toBeNull();
      expect(growUpTo(running, TEN_DAYS_LATER).endedAt).toEqual(new Date('2026-05-10T08:00:00.000Z'));
    });

    it('leaves the plants where they stood, not where they were moved to afterwards', () => {
      const seen = summaryOf(growUpTo(running, FIVE_DAYS_IN), planted('a'), NOTHING_HIDDEN, FIVE_DAYS_IN);

      expect(seen.locations.map(where => where.spaceId)).toEqual([TENT]);
    });
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

  /**
   * A grow the migration reconstructed carries no plants at all, and moving one
   * has to close where it was all the same - otherwise it stands in two tents
   * at once, which is what every reader of the placements would then believe.
   */
  it('moves a grow with no plants of its own, and closes where it was', async () => {
    const grow = await started({ plants: [] });
    await grows.addPlacement(session(OWNER), grow.id, { spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    const moved = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(moved.placements.filter(row => row.endedAt === null).map(row => row.spaceId)).toEqual([FRIDGE]);
  });
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * A phase and a placement are each one fact told twice - once in the grow's own
 * list and once as the line that announced it - so what is asserted about every
 * correction is that both moved. A diary still saying the old thing is read as
 * the truth by every week card, which take their stage from the phases and their
 * lines from the diary.
 */
const phaseLineOf = async (growId: string, phaseId: string) => db.entries.findOne({ growId, kind: 'phase', 'values.phaseId': phaseId }).lean();
const moveLineOf = async (growId: string, placementId: string) =>
  db.entries.findOne({ growId, kind: 'move', 'values.placementId': placementId }).lean();

describe('correcting a phase', () => {
  const WRONG_DAY = new Date('2026-05-03T08:00:00.000Z');

  it('moves the stage and the line that announced it together', async () => {
    const grow = await started();
    const entered = await grows.addPhase(grow.id, { stage: 'seedling' }, OWNER, NOTHING_HIDDEN);

    const corrected = await grows.updatePhase(grow.id, entered.id, { stage: 'vegetative' }, NOTHING_HIDDEN);

    expect(corrected.stage).toBe('vegetative');
    expect((await phaseLineOf(grow.id, entered.id))?.values).toMatchObject({ kind: 'phase', stage: 'vegetative' });
  });

  it('leaves who put the grow there alone, because a mistyped date decided nothing', async () => {
    const grow = await started();
    const entered = await grows.addPhase(grow.id, { stage: 'seedling', preset: 'early_seedling' }, OWNER, NOTHING_HIDDEN);
    expect(entered.source).toBe('preset');

    const corrected = await grows.updatePhase(grow.id, entered.id, { startedAt: WRONG_DAY.toISOString() }, NOTHING_HIDDEN);
    expect(corrected).toMatchObject({ source: 'preset', setBy: null, deviceId: DEVICE });
  });

  it('moves the day counter with the date, and the line with it', async () => {
    const grow = await started();
    const entered = await grows.addPhase(grow.id, { stage: 'vegetative', startedAt: WRONG_DAY.toISOString() }, OWNER, NOTHING_HIDDEN);

    await grows.updatePhase(grow.id, entered.id, { startedAt: STARTED_AT.toISOString() }, NOTHING_HIDDEN);

    const read = serialiseGrow(await grows.require(grow.id), await plantsOfGrow(grow.id), NOTHING_HIDDEN, TEN_DAYS_LATER);
    expect(read.summary.dayNumber).toBe(11);
    expect((await phaseLineOf(grow.id, entered.id))?.occurredAt).toEqual(STARTED_AT);
  });

  it('keeps the phases in date order when a correction moves one past another', async () => {
    const grow = await started();
    const first = await grows.addPhase(grow.id, { stage: 'seedling', startedAt: STARTED_AT.toISOString() }, OWNER, NOTHING_HIDDEN);
    await grows.addPhase(grow.id, { stage: 'vegetative', startedAt: WRONG_DAY.toISOString() }, OWNER, NOTHING_HIDDEN);

    await grows.updatePhase(grow.id, first.id, { startedAt: TEN_DAYS_LATER.toISOString() }, NOTHING_HIDDEN);

    const read = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(read.phases.map(row => row.stage)).toEqual(['vegetative', 'seedling']);
    expect(read.summary.stage).toBe('seedling');
  });

  it('refuses a scope with a plant of another grow in it', async () => {
    const grow = await started();
    const entered = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    await expect(grows.updatePhase(grow.id, entered.id, { plantIds: ['plant-elsewhere'] }, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });

  it('says there is no such phase rather than inventing one', async () => {
    const grow = await started();
    await expect(grows.updatePhase(grow.id, 'no-such-phase', { stage: 'drying' }, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });
});

describe('taking a phase back', () => {
  it('removes the line that announced it', async () => {
    const grow = await started();
    const entered = await grows.addPhase(grow.id, { stage: 'vegetative' }, OWNER, NOTHING_HIDDEN);

    await grows.removePhase(grow.id, entered.id);

    expect((await grows.read(grow.id, NOTHING_HIDDEN)).phases).toEqual([]);
    expect(await phaseLineOf(grow.id, entered.id)).toBeNull();
  });

  it('gives the day counter back to the phase that is left', async () => {
    const grow = await started();
    const tooEarly = await grows.addPhase(grow.id, { stage: 'germination', startedAt: STARTED_AT.toISOString() }, OWNER, NOTHING_HIDDEN);
    await grows.addPhase(grow.id, { stage: 'seedling', startedAt: new Date('2026-05-06T08:00:00.000Z').toISOString() }, OWNER, NOTHING_HIDDEN);

    await grows.removePhase(grow.id, tooEarly.id);

    const read = serialiseGrow(await grows.require(grow.id), await plantsOfGrow(grow.id), NOTHING_HIDDEN, TEN_DAYS_LATER);
    expect(read.summary.dayNumber).toBe(6);
  });

  it('says there is no such phase', async () => {
    const grow = await started();
    await expect(grows.removePhase(grow.id, 'no-such-phase')).rejects.toThrow(ProblemException);
  });
});

describe('correcting a placement', () => {
  it('closes one that was left open, on the day the plants really left', async () => {
    const grow = await started();
    const open = (await grows.read(grow.id, NOTHING_HIDDEN)).placements[0];

    const closed = await grows.updatePlacement(session(OWNER), grow.id, open.id, { endedAt: TEN_DAYS_LATER.toISOString() }, NOTHING_HIDDEN);

    expect(closed.endedAt).toBe(TEN_DAYS_LATER.toISOString());
    expect((await grows.read(grow.id, NOTHING_HIDDEN)).summary.locations).toEqual([]);
  });

  it('moves the line that announced the move with it', async () => {
    const grow = await started();
    const moved = await grows.addPlacement(session(OWNER), grow.id, { spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    await grows.updatePlacement(session(OWNER), grow.id, moved.id, { spaceId: null }, NOTHING_HIDDEN);

    const line = await moveLineOf(grow.id, moved.id);
    expect(line?.values).toMatchObject({ kind: 'move', spaceId: null });
    expect(line?.spaceId).toBeNull();
  });

  it('refuses an end that comes before the start', async () => {
    const grow = await started();
    const open = (await grows.read(grow.id, NOTHING_HIDDEN)).placements[0];

    await expect(
      grows.updatePlacement(
        session(OWNER),
        grow.id,
        open.id,
        { startedAt: TEN_DAYS_LATER.toISOString(), endedAt: STARTED_AT.toISOString() },
        NOTHING_HIDDEN,
      ),
    ).rejects.toThrow(ProblemException);
  });

  it('refuses a space the caller may not manage', async () => {
    const grow = await started();
    const open = (await grows.read(grow.id, NOTHING_HIDDEN)).placements[0];

    await expect(grows.updatePlacement(session(MEMBER), grow.id, open.id, { spaceId: FRIDGE }, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });
});

describe('taking a move back', () => {
  it('removes the placement and the line that announced it', async () => {
    const grow = await started();
    const moved = await grows.addPlacement(
      session(OWNER),
      grow.id,
      { spaceId: FRIDGE, plantIds: (await plantsOfGrow(grow.id)).slice(0, 1).map(plant => plant.id) },
      OWNER,
      NOTHING_HIDDEN,
    );

    await grows.removePlacement(grow.id, moved.id);

    expect((await grows.read(grow.id, NOTHING_HIDDEN)).placements.map(row => row.id)).not.toContain(moved.id);
    expect(await moveLineOf(grow.id, moved.id)).toBeNull();
  });

  it('refuses the only placement that says where the grow is', async () => {
    const grow = await started();
    const open = (await grows.read(grow.id, NOTHING_HIDDEN)).placements[0];

    await expect(grows.removePlacement(grow.id, open.id)).rejects.toThrow(ProblemException);
  });
});

// ---------------------------------------------------------------------------
// Harvests and splits
// ---------------------------------------------------------------------------

describe('harvesting', () => {
  it('cuts every plant that is still standing and ends the grow', async () => {
    const grow = await started();
    await grows.addPhase(grow.id, { stage: 'flowering' }, OWNER, NOTHING_HIDDEN);

    const cut = await grows.harvest(grow.id, { harvestedAt: TEN_DAYS_LATER.toISOString() }, OWNER, NOTHING_HIDDEN);

    expect(cut.plants).toHaveLength(3);
    expect(cut.plants.every(plant => plant.status === 'harvested')).toBe(true);
    expect((await grows.require(grow.id)).endedAt).toEqual(TEN_DAYS_LATER);
  });

  it('leaves the grow running while some of its plants stay up', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    const cut = await grows.harvest(grow.id, { plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);

    expect(cut.plants.map(plant => plant.id)).toEqual([plants[0].id]);
    expect((await grows.require(grow.id)).endedAt).toBeNull();
  });

  it('ends the grow once the last of them comes down', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    await grows.harvest(grow.id, { plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);
    expect((await grows.require(grow.id)).endedAt).toBeNull();

    await grows.harvest(grow.id, { plantIds: [plants[1].id, plants[2].id] }, OWNER, NOTHING_HIDDEN);
    expect((await grows.require(grow.id)).endedAt).not.toBeNull();
  });

  it('shares the weight out so that the plants add up to exactly what was typed in', async () => {
    const grow = await started();
    const cut = await grows.harvest(grow.id, { wetWeightG: 800, dryWeightG: 181 }, OWNER, NOTHING_HIDDEN);

    const total = (weights: (number | null)[]): number => weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
    expect(total(cut.plants.map(plant => plant.harvest?.wetWeightG ?? null))).toBeCloseTo(800, 5);
    expect(total(cut.plants.map(plant => plant.harvest?.dryWeightG ?? null))).toBeCloseTo(181, 5);
  });

  it('writes the harvest on the timeline with the totals, not with a plant´s share', async () => {
    const grow = await started();
    const cut = await grows.harvest(grow.id, { wetWeightG: 800, dryWeightG: 181 }, OWNER, NOTHING_HIDDEN);

    const line = await db.entries.findOne({ id: cut.entryId }).lean();
    expect(line?.values).toMatchObject({ kind: 'harvest', wetWeightG: 800, dryWeightG: 181 });
    expect(line?.plantIds).toHaveLength(3);
    expect(line?.spaceId).toBe(TENT);
  });

  it('refuses a plant that has already come down, so the report cannot count it twice', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.harvest(grow.id, { plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);

    await expect(grows.harvest(grow.id, { plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });

  it('refuses a grow with nothing left to cut', async () => {
    const grow = await started();
    await grows.harvest(grow.id, {}, OWNER, NOTHING_HIDDEN);

    await expect(grows.harvest(grow.id, {}, OWNER, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });

  it('refuses a plant that belongs to another grow', async () => {
    const grow = await started();
    await expect(grows.harvest(grow.id, { plantIds: ['plant-elsewhere'] }, OWNER, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });

  it('hands back no weights to a reader they are hidden from', async () => {
    const grow = await started();
    const cut = await grows.harvest(grow.id, { wetWeightG: 800, dryWeightG: 181 }, OWNER, { weights: true, counts: false, authors: true });

    expect(cut.plants.every(plant => plant.harvest?.wetWeightG === null && plant.harvest?.dryWeightG === null)).toBe(true);
  });
});

describe('splitting a grow', () => {
  it('gives the plants a phase and a place of their own and leaves the rest where they were', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.addPhase(grow.id, { stage: 'flowering' }, OWNER, NOTHING_HIDDEN);

    const split = await grows.split(session(OWNER), grow.id, { plantIds: [plants[0].id], stage: 'drying', spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    expect(split.phase).toMatchObject({ stage: 'drying', plantIds: [plants[0].id] });
    expect(split.placement).toMatchObject({ spaceId: FRIDGE, plantIds: [plants[0].id] });

    const read = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(read.summary.stage).toBe('flowering');
    expect(read.summary.groups.map(group => group.stage)).toEqual(['flowering', 'drying']);
    expect(read.summary.locations).toEqual([
      { spaceId: TENT, plantIds: [plants[1].id, plants[2].id] },
      { spaceId: FRIDGE, plantIds: [plants[0].id] },
    ]);
  });

  it('reads the phase from where the plants have gone, not from where they were', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    const split = await grows.split(
      session(OWNER),
      grow.id,
      { plantIds: [plants[0].id], stage: 'drying', preset: 'slow_dry', spaceId: FRIDGE },
      OWNER,
      NOTHING_HIDDEN,
    );

    expect(applied).toEqual([{ spaceId: FRIDGE, stage: 'drying', preset: 'slow_dry' }]);
    expect(split.phase?.source).toBe('preset');
  });

  it('gives them a phase alone where no space was named', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    const split = await grows.split(session(OWNER), grow.id, { plantIds: [plants[0].id], stage: 'drying' }, OWNER, NOTHING_HIDDEN);

    expect(split.placement).toBeNull();
    expect(split.phase?.stage).toBe('drying');
  });

  it('refuses a split that gives them neither', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    await expect(grows.split(session(OWNER), grow.id, { plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN)).rejects.toThrow(ProblemException);
  });

  it('refuses a plant that belongs to another grow', async () => {
    const grow = await started();
    await expect(grows.split(session(OWNER), grow.id, { plantIds: ['plant-elsewhere'], stage: 'drying' }, OWNER, NOTHING_HIDDEN)).rejects.toThrow(
      ProblemException,
    );
  });

  it('refuses a space the caller may not manage', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);

    await expect(grows.split(session(MEMBER), grow.id, { plantIds: [plants[0].id], spaceId: FRIDGE }, MEMBER, NOTHING_HIDDEN)).rejects.toThrow(
      ProblemException,
    );
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

  /**
   * A phase and a placement each state a set of plants, so a plant that is gone
   * has to leave both: an id in one of them that names no plant is a plant the
   * grow still says it has, which the summary would put somewhere and the count
   * would include.
   */
  it('leaves the scopes that named it when it is removed', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.split(session(OWNER), grow.id, { plantIds: [plants[0].id, plants[1].id], stage: 'drying', spaceId: FRIDGE }, OWNER, NOTHING_HIDDEN);

    await grows.removePlant(plants[0].id);

    const read = await grows.read(grow.id, NOTHING_HIDDEN);
    expect(read.phases.flatMap(row => row.plantIds ?? [])).toEqual([plants[1].id]);
    expect(read.placements.flatMap(row => row.plantIds ?? [])).not.toContain(plants[0].id);
    expect(read.summary.locations.flatMap(where => where.plantIds)).not.toContain(plants[0].id);
  });

  it('takes a scope that was only that plant away with it', async () => {
    const grow = await started();
    const plants = await plantsOfGrow(grow.id);
    await grows.addPhase(grow.id, { stage: 'drying', plantIds: [plants[0].id] }, OWNER, NOTHING_HIDDEN);

    await grows.removePlant(plants[0].id);

    expect((await grows.read(grow.id, NOTHING_HIDDEN)).phases).toEqual([]);
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
  'PATCH /grows/{id}/phases/{phaseId}': GrowsController.prototype.updatePhase,
  'DELETE /grows/{id}/phases/{phaseId}': GrowsController.prototype.removePhase,
  'POST /grows/{id}/placements': GrowsController.prototype.addPlacement,
  'PATCH /grows/{id}/placements/{placementId}': GrowsController.prototype.updatePlacement,
  'DELETE /grows/{id}/placements/{placementId}': GrowsController.prototype.removePlacement,
  'POST /grows/{id}/harvests': GrowsController.prototype.harvest,
  'POST /grows/{id}/splits': GrowsController.prototype.split,
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
