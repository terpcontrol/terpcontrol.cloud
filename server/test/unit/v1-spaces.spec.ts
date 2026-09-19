import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { AccessGuard } from '@common/v1/access.guard';
import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { DataService } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { DeviceConfigurationWriter } from '@modules/v1/plan/device-configuration.port';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { MailService } from '@modules/mail/mail.service';
import { ClimatePresetsService } from '@modules/v1/space/climate-presets.service';
import { PresetApplicationsService } from '@modules/v1/space/preset-applications.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesController } from '@modules/v1/space/spaces.controller';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Spaces: the places everything else on the home screen hangs off, and the one
 * resource whose whole point is that other things point at it.
 *
 * Two things are asserted here that a screen would never show: what a space
 * refuses to do while something still stands in it, and who may do what to one.
 * The second is the access matrix for these routes - a mistake there is a hole
 * rather than a wrong screen - so every route is run for every kind of caller
 * rather than for the cases somebody thought of.
 *
 * The world is one room with two tents in it, a manager who holds their
 * membership on the room and has to reach both, and a member of one tent who
 * may only write in it.
 */

const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const DEVICE = 'device-1';
const CAMERA = 'camera-1';
const GROW = 'grow-1';

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const admin: AccessContext = { userId: 'user-admin', isAdmin: true, isDemo: false, shareToken: null };
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };

let db: V1TestDatabase;
let access: AccessService;
let spaces: SpacesService;
let presets: PresetApplicationsService;
let controller: SpacesController;
let guard: AccessGuard;

/** What was sent to a device, since a unit suite has no broker to send it over. */
let configured: { deviceId: string; settings: DeviceConfiguration }[];

const seed = async (): Promise<void> => {
  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    { id: SPACE, ownerId: OWNER, kind: 'tent', name: 'The tent', roomId: ROOM, createdAt: new Date('2026-01-02T00:00:00.000Z') },
    { id: OTHER_SPACE, ownerId: OWNER, kind: 'tent', name: 'The other tent', roomId: ROOM, createdAt: new Date('2026-01-03T00:00:00.000Z') },
  ]);

  // One membership on the room, which has to widen to the tents in it, and one
  // on a tent alone.
  await db.memberships.create([
    { id: 'membership-manager', spaceId: ROOM, userId: MANAGER, role: 'can_manage' },
    { id: 'membership-member', spaceId: SPACE, userId: MEMBER, role: 'can_log' },
  ]);

  // Standing in the other tent, so that the space under test is empty and can
  // be ended, and the device can be moved into it.
  await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: OTHER_SPACE });
};

const refusal = async (action: () => unknown): Promise<ProblemException> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error('It was allowed.');
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

/**
 * The preset half of this controller, built for real against the same database:
 * what is asked of it here is who may apply one, and that decision is the
 * guard's rather than the service's. Nothing is sent to a device, because there
 * is no broker in a unit suite.
 */
const presetsOf = (): PresetApplicationsService => {
  const written = new EntryWriterService(db.entries);
  const phases = new PhaseWriterService(db.grows, written, db.entries);
  const configuration: DeviceConfigurationWriter = {
    applyConfiguration: async (deviceId, settings) => {
      configured.push({ deviceId, settings });
      return true;
    },
  };
  const grows = new GrowsService(
    db.grows,
    db.plants,
    db.devices,
    db.memberships,
    db.spaces,
    db.users,
    db.shareLinks,
    db.entries,
    access,
    phases,
    written,
  );
  const plans = new PlanService(
    db.plans,
    new PlanProgressService(db.plans, db.devices, db.users, written, phases, { send: async () => undefined } as unknown as MailService),
  );

  return new PresetApplicationsService(
    db.devices,
    db.grows,
    new ClimatePresetsService(db.devices, configuration),
    spaces,
    phases,
    plans,
    grows,
    access,
  );
};

beforeEach(async () => {
  await db.reset();
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  spaces = new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);
  configured = [];
  presets = presetsOf();
  controller = new SpacesController(spaces, new SpaceLiveService(db.devices, db.cameras, {} as DataService), presets, access);
  guard = new AccessGuard(new Reflector(), access);
  await seed();
});

describe('making one', () => {
  it('needs nothing but a kind and a name, and defaults the rest', async () => {
    const space = await spaces.create(session(STRANGER), { kind: 'fridge', name: 'The fridge' });

    expect(space).toMatchObject({
      ownerId: STRANGER,
      kind: 'fridge',
      name: 'The fridge',
      roomId: null,
      presetPrompt: 'ask',
      retention: { climateDays: null },
      isDemo: false,
      archivedAt: null,
    });
  });

  it('gives a space made in a room to the room´s owner, not to the manager who made it', async () => {
    const space = await spaces.create(session(MANAGER), { kind: 'tent', name: 'A third tent', roomId: ROOM });

    expect(space.ownerId).toBe(OWNER);
    expect(space.roomId).toBe(ROOM);
  });

  it('refuses to put a room in a room', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'room', name: 'Inner', roomId: ROOM }));

    expect(problem.problem).toMatchObject({ status: 422, code: 'room_in_room' });
  });

  it('refuses to group a space under something that is not a room', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'tent', name: 'Nested', roomId: SPACE }));

    expect(problem.problem).toMatchObject({ status: 422, code: 'not_a_room' });
  });

  it('is not something a session without an account can do', async () => {
    const problem = await refusal(() => spaces.create(demo, { kind: 'tent', name: 'Mine now' }));

    expect(problem.problem.code).toBe('no_account');
  });
});

describe('changing one', () => {
  it('renames it and leaves everything else alone', async () => {
    const changed = await spaces.update(session(OWNER), SPACE, { name: 'The big tent' });

    expect(changed).toMatchObject({ name: 'The big tent', kind: 'tent', roomId: ROOM });
  });

  it('moves it into a room the caller manages', async () => {
    const loose = await spaces.create(session(OWNER), { kind: 'balcony', name: 'The balcony' });
    const moved = await spaces.update(session(MANAGER), loose.id, { roomId: ROOM });

    expect(moved.roomId).toBe(ROOM);
  });

  it('refuses a room of another account, because a room and its spaces are shared as one', async () => {
    const theirs = await spaces.create(session(STRANGER), { kind: 'room', name: 'Their room' });
    const problem = await refusal(() => spaces.update(admin, SPACE, { roomId: theirs.id }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'room_of_another_account' });
  });

  it('refuses to group a space under itself', async () => {
    const problem = await refusal(() => spaces.update(session(OWNER), SPACE, { roomId: SPACE }));

    expect(problem.problem.code).toBe('room_in_room');
  });

  it('refuses to turn a space that hangs in a room into a room', async () => {
    const problem = await refusal(() => spaces.update(session(OWNER), SPACE, { kind: 'room' }));

    expect(problem.problem.code).toBe('room_in_room');
  });

  it('refuses to stop being a room while spaces are grouped under it', async () => {
    const problem = await refusal(() => spaces.update(session(OWNER), ROOM, { kind: 'tent' }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'room_not_empty' });
  });
});

describe('listing them', () => {
  it('leaves archived spaces out, and lists them when they are asked for', async () => {
    await spaces.archive(SPACE, true);

    const inUse = await spaces.list(session(OWNER), {}, {});
    const archived = await spaces.list(session(OWNER), {}, { archived: true });

    expect(inUse.items.map(space => space.id)).toEqual([ROOM, OTHER_SPACE]);
    expect(archived.items.map(space => space.id)).toEqual([SPACE]);
  });

  it('shows a member of a room the spaces inside it', async () => {
    const page = await spaces.list(session(MANAGER), {}, {});

    expect(page.items.map(space => space.id)).toEqual([ROOM, SPACE, OTHER_SPACE]);
  });

  it('shows a member of one tent that tent and no other', async () => {
    const page = await spaces.list(session(MEMBER), {}, {});

    expect(page.items.map(space => space.id)).toEqual([SPACE]);
  });

  it('tells a stranger about nothing', async () => {
    expect((await spaces.list(session(STRANGER), {}, {})).items).toEqual([]);
  });

  it('shows a demo session the demo spaces, and nobody´s real ones', async () => {
    await db.spaces.create({ id: 'space-demo', ownerId: 'user-tour', kind: 'tent', name: 'The demo tent', isDemo: true });

    expect((await spaces.list(demo, {}, {})).items.map(space => space.id)).toEqual(['space-demo']);
  });

  it('never lets a later page reach past what the caller may see', async () => {
    await db.spaces.create({ id: 'space-theirs', ownerId: STRANGER, kind: 'tent', name: 'Theirs', createdAt: new Date('2026-01-02T12:00:00.000Z') });
    await db.memberships.create({ id: 'membership-member-2', spaceId: OTHER_SPACE, userId: MEMBER, role: 'can_log' });

    const first = await spaces.list(session(MEMBER), { limit: 1 }, {});
    const second = await spaces.list(session(MEMBER), { limit: 1, cursor: first.nextCursor ?? '' }, {});

    // The visibility and the cursor are each a condition of their own; a page
    // that let the cursor replace the visibility would continue into the
    // stranger's space, which is the next row by date.
    expect(first.items.map(space => space.id)).toEqual([SPACE]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map(space => space.id)).toEqual([OTHER_SPACE]);
  });

  it('narrows to one room', async () => {
    const page = await spaces.list(session(OWNER), {}, { roomId: ROOM });

    expect(page.items.map(space => space.id)).toEqual([SPACE, OTHER_SPACE]);
  });
});

describe('archiving one', () => {
  it('says the same thing twice without moving the instant it carries', async () => {
    const archived = await spaces.archive(SPACE, true);
    const again = await spaces.archive(SPACE, true);

    expect(archived.archivedAt).not.toBeNull();
    expect(again.archivedAt).toBe(archived.archivedAt);
  });

  it('brings it back', async () => {
    await spaces.archive(SPACE, true);

    expect((await spaces.archive(SPACE, false)).archivedAt).toBeNull();
  });

  it('refuses a room whose spaces are still in use', async () => {
    const problem = await refusal(() => spaces.archive(ROOM, true));

    expect(problem.problem).toMatchObject({ status: 409, code: 'room_not_empty' });
  });

  it('takes a room once the spaces in it are archived too', async () => {
    await spaces.archive(SPACE, true);
    await spaces.archive(OTHER_SPACE, true);

    expect((await spaces.archive(ROOM, true)).archivedAt).not.toBeNull();
  });
});

describe('ending one', () => {
  const codesOf = (problem: ProblemException): string[] => problem.problem.errors.map(error => error.code);

  it('keeps the space as a tombstone, because history still names it', async () => {
    await spaces.remove(SPACE);

    expect((await spaces.list(session(OWNER), {}, {})).items.map(space => space.id)).toEqual([ROOM, OTHER_SPACE]);
    expect((await spaces.byId(SPACE))?.archivedAt).not.toBeNull();
  });

  it('takes the way in with it', async () => {
    await db.invites.create({ id: 'invite-1', code: 'ABCD2345', spaceId: SPACE, role: 'can_log', createdBy: OWNER });
    await spaces.remove(SPACE);

    expect(await db.memberships.countDocuments({ spaceId: SPACE })).toBe(0);
    expect(await db.invites.countDocuments({ spaceId: SPACE })).toBe(0);
  });

  it('refuses while a device stands there', async () => {
    const problem = await refusal(() => spaces.remove(OTHER_SPACE));

    expect(problem.problem).toMatchObject({ status: 409, code: 'space_in_use' });
    expect(codesOf(problem)).toEqual(['device_here']);
  });

  it('refuses while a camera looks into it', async () => {
    await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_standalone', name: 'The cam', spaceId: SPACE });
    expect(codesOf(await refusal(() => spaces.remove(SPACE)))).toEqual(['camera_here']);
  });

  it('refuses while a grow is standing in it', async () => {
    await db.grows.create({
      id: GROW,
      ownerId: OWNER,
      name: 'The grow',
      type: 'photoperiod',
      slug: 'the-grow',
      placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: new Date('2026-01-05T00:00:00.000Z'), endedAt: null, plantIds: null }],
      startedAt: new Date('2026-01-05T00:00:00.000Z'),
    });

    expect(codesOf(await refusal(() => spaces.remove(SPACE)))).toEqual(['grow_here']);
  });

  it('allows it once the grow has moved on', async () => {
    await db.grows.create({
      id: GROW,
      ownerId: OWNER,
      name: 'The grow',
      type: 'photoperiod',
      slug: 'the-grow',
      placements: [
        {
          id: 'placement-1',
          spaceId: SPACE,
          startedAt: new Date('2026-01-05T00:00:00.000Z'),
          endedAt: new Date('2026-02-05T00:00:00.000Z'),
          plantIds: null,
        },
      ],
      startedAt: new Date('2026-01-05T00:00:00.000Z'),
    });

    await spaces.remove(SPACE);
    expect((await spaces.byId(SPACE))?.archivedAt).not.toBeNull();
  });

  it('refuses a room that still groups spaces', async () => {
    expect(codesOf(await refusal(() => spaces.remove(ROOM)))).toEqual(['space_here']);
  });
});

describe('what stands in it', () => {
  it('moves a device in, and the camera its controller answers for with it', async () => {
    await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', name: 'The cam', deviceId: DEVICE, spaceId: OTHER_SPACE });
    const device = await spaces.placeDevice(SPACE, DEVICE, false);

    expect(device.spaceId).toBe(SPACE);
    expect((await db.cameras.findOne({ id: CAMERA }).lean())?.spaceId).toBe(SPACE);
  });

  it('takes a device out, which leaves it standing nowhere', async () => {
    await spaces.removeDevice(OTHER_SPACE, DEVICE);

    expect((await db.devices.findOne({ id: DEVICE }).lean())?.spaceId).toBeNull();
  });

  it('refuses to take a device out of a space it is not in', async () => {
    const problem = await refusal(() => spaces.removeDevice(SPACE, DEVICE));

    expect(problem.problem).toMatchObject({ status: 404, code: 'device_not_here' });
  });

  it('refuses to put anything into a space that has ended', async () => {
    await spaces.archive(SPACE, true);
    const problem = await refusal(() => spaces.placeDevice(SPACE, DEVICE, false));

    expect(problem.problem).toMatchObject({ status: 409, code: 'space_archived' });
  });
});

// ---------------------------------------------------------------------------
// The phase tiles
// ---------------------------------------------------------------------------

/**
 * Applying a climate preset: the tent is put on the stage's climate and the grow
 * standing in it enters the stage. What is asserted is that neither invents the
 * other - a tent with no grow in it still has its climate written, and a
 * controller merely being on invents no grow - and that what reaches the device
 * is the section it was tuned with rather than a fresh one.
 */
const CONTROLLER = 'device-controller';
const GROW_HERE = 'grow-here';
const GROW_ELSEWHERE = 'grow-elsewhere';
const A_WHILE_AGO = new Date('2026-04-01T08:00:00.000Z');

/** The firmware's own defaults, plus the ramps somebody tuned: lights on at 06:00, off at 18:00. */
const TUNED: DeviceConfiguration = {
  workmode: 'small',
  daynight: { day: 21600, night: 64800, minimalDehumidifierOffTime: 240 },
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 21, humidity: 55 },
  co2: { target: 300 },
  lights: { sunrise: 15, sunset: 15, limit: 100 },
};

const aController = (spaceId: string | null = SPACE, configuration: DeviceConfiguration | null = TUNED) =>
  db.devices.create({ id: CONTROLLER, type: 'controller', ownerId: OWNER, spaceId, configuration });

const aGrowIn = (id: string, spaceId: string) =>
  db.grows.create({
    id,
    ownerId: OWNER,
    name: id,
    type: 'photoperiod',
    slug: id,
    startedAt: A_WHILE_AGO,
    placements: [{ id: `placement-${id}`, spaceId, startedAt: A_WHILE_AGO, endedAt: null, plantIds: null }],
  });

const aRunningPlan = (stageOfTheNextStep: string | null) =>
  db.plans.create({
    id: 'plan-1',
    deviceId: CONTROLLER,
    name: 'The plan',
    steps: [
      { id: 'step-1', name: 'Veg', stage: 'vegetative', duration: { value: 3, unit: 'weeks' }, settings: {} },
      { id: 'step-2', name: 'Next', stage: stageOfTheNextStep, duration: { value: 8, unit: 'weeks' }, settings: {} },
    ],
    loop: false,
    notify: { mode: 'off', email: null, writeEntries: true },
    state: { status: 'running', activeStepIndex: 0, stepStartedAt: A_WHILE_AGO, pausedElapsedMs: 0 },
  });

describe('applying a climate preset', () => {
  it('puts the controllers standing here on the stage´s climate', async () => {
    await aController();
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(applied.deviceIds).toEqual([CONTROLLER]);
    expect(configured[0].settings).toMatchObject({
      day: { temperature: 26, humidity: 62 },
      night: { temperature: 22, humidity: 58 },
      co2: { target: 900 },
      lights: { limit: 80 },
    });
  });

  it('keeps the hour the light comes on and the tuning around it, and writes only how long it stays on', async () => {
    await aController();
    await presets.apply(session(OWNER), SPACE, { stage: 'flowering' });

    // Twelve hours from the same 06:00, and the ramps and the dehumidifier
    // timing untouched: a preset is a target climate, not a re-tuned tent.
    expect(configured[0].settings).toMatchObject({
      daynight: { day: 21600, night: 21600 + 12 * 60 * 60, minimalDehumidifierOffTime: 240 },
      lights: { sunrise: 15, sunset: 15, limit: 100 },
    });
  });

  it('draws late flower from the preset on top of the stage rather than from a seventh stage', async () => {
    await aController();
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'flowering', preset: 'late_flowering' });

    expect(applied.stage).toBe('flowering');
    expect(configured[0].settings).toMatchObject({ day: { temperature: 24, humidity: 45 }, night: { temperature: 18, humidity: 45 } });
  });

  it('falls back to the stage itself for a preset the table has never heard of', async () => {
    await aController();
    await presets.apply(session(OWNER), SPACE, { stage: 'vegetative', preset: 'whatever_the_client_ships_next' });

    expect(configured[0].settings).toMatchObject({ day: { temperature: 26, humidity: 62 } });
  });

  it('writes nothing to a device that states no targets, because a plug has no climate', async () => {
    await db.devices.create({ id: 'device-plug', type: 'plug', ownerId: OWNER, spaceId: SPACE, configuration: null });
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(applied.deviceIds).toEqual([]);
    expect(configured).toEqual([]);
  });

  it('sets the phase of the grow standing here, and marks it as the preset´s', async () => {
    await aController();
    await aGrowIn(GROW_HERE, SPACE);

    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(applied).toMatchObject({ growId: GROW_HERE, growDecisionNeeded: false, decisions: [] });
    expect(applied.phaseId).toEqual(expect.any(String));

    const grow = await db.grows.findOne({ id: GROW_HERE }).lean();
    expect(grow?.phases[0]).toMatchObject({ stage: 'vegetative', source: 'preset', setBy: null, deviceId: CONTROLLER });
    expect(grow?.phases[0].targets).toMatchObject({ day: { temperature: 26 } });
  });

  it('names the phase the grow already stood in rather than appending it twice', async () => {
    await aController();
    await aGrowIn(GROW_HERE, SPACE);

    const first = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });
    const again = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(again.phaseId).toBe(first.phaseId);
    expect((await db.grows.findOne({ id: GROW_HERE }).lean())?.phases).toHaveLength(1);
  });

  it('asks what to do about the grow where none stands here, and changes the tent anyway', async () => {
    await aController();
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(applied).toMatchObject({ growId: null, phaseId: null, growDecisionNeeded: true });
    expect(applied.decisions).toEqual(['start_grow', 'move_grow', 'climate_only']);
    expect(applied.deviceIds).toEqual([CONTROLLER]);
  });

  it('does not ask a space that has been told never to', async () => {
    await aController();
    await db.spaces.updateOne({ id: SPACE }, { $set: { presetPrompt: 'never' } });

    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });
    expect(applied).toMatchObject({ growDecisionNeeded: false, decisions: [] });
  });

  it('stops asking once the client has answered that only the climate was meant', async () => {
    await aController();
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative', decision: 'climate_only' });

    expect(applied).toMatchObject({ growId: null, growDecisionNeeded: false, decisions: [] });
  });

  it('leaves the new-grow sheet to start a grow, because this route carries neither a name nor plants', async () => {
    await aController();
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative', decision: 'start_grow' });

    expect(applied).toMatchObject({ growId: null, growDecisionNeeded: false });
    expect(await db.grows.countDocuments()).toBe(0);
  });

  it('moves the grow the client named here and sets its phase', async () => {
    await aController();
    await aGrowIn(GROW_ELSEWHERE, OTHER_SPACE);

    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'flowering', decision: 'move_grow', growId: GROW_ELSEWHERE });

    expect(applied.growId).toBe(GROW_ELSEWHERE);
    const grow = await db.grows.findOne({ id: GROW_ELSEWHERE }).lean();
    expect(grow?.placements.filter(row => row.endedAt === null).map(row => row.spaceId)).toEqual([SPACE]);
    expect(grow?.phases[0]).toMatchObject({ stage: 'flowering', source: 'preset' });
  });

  it('refuses to move a grow the caller may not manage', async () => {
    await aController();
    await db.grows.create({
      id: GROW_ELSEWHERE,
      ownerId: STRANGER,
      name: 'Somebody else´s',
      type: 'photoperiod',
      slug: GROW_ELSEWHERE,
      startedAt: A_WHILE_AGO,
      placements: [],
    });

    const problem = await refusal(() => presets.apply(session(OWNER), SPACE, { stage: 'flowering', decision: 'move_grow', growId: GROW_ELSEWHERE }));
    expect(problem.problem.status).toBe(404);
  });

  it('refuses a move that names no grow', async () => {
    await aController();
    const problem = await refusal(() => presets.apply(session(OWNER), SPACE, { stage: 'flowering', decision: 'move_grow' }));

    expect(problem.problem.code).toBe('grow_not_named');
  });

  /**
   * A plan re-applies its step hourly, so the two cannot both hold the tent. The
   * preset is written either way; what changes is whether the plan is carried
   * forward to the same stage or stopped where it is.
   */
  it('moves a running plan on where its next step carries the stage that was asked for', async () => {
    await aController();
    await aRunningPlan('flowering');

    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'flowering' });

    expect(applied.planEffect).toBe('skipped');
    expect((await db.plans.findOne({ id: 'plan-1' }).lean())?.state).toMatchObject({ status: 'running', activeStepIndex: 1 });
  });

  it('pauses a running plan whose next step does not, so the preset is what the tent keeps', async () => {
    await aController();
    await aRunningPlan('curing');

    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'flowering' });

    expect(applied.planEffect).toBe('paused');
    expect((await db.plans.findOne({ id: 'plan-1' }).lean())?.state).toMatchObject({ status: 'paused', activeStepIndex: 0 });
  });

  it('leaves a tent with no plan in it alone', async () => {
    await aController();
    expect((await presets.apply(session(OWNER), SPACE, { stage: 'flowering' })).planEffect).toBe('none');
  });
});

/**
 * Every route of this controller, run end to end for every kind of caller: the
 * guard that decides from what the route declares, and then the handler, which
 * for the two device routes asks a second time about the device.
 *
 * A route is set up so that the owner gets through it, so that a refusal here is
 * always a decision about the caller and never the route refusing for a reason
 * of its own. What comes back is compared as one table, because a hole shows up
 * as the row it is where an assertion per cell would stop at the first one.
 */
interface RouteCase {
  name: string;
  handler: keyof SpacesController;
  params: Record<string, string>;
  setUp?: () => Promise<unknown>;
  run: (ctx: AccessContext) => Promise<unknown>;
}

const ROUTES: RouteCase[] = [
  {
    name: 'create',
    handler: 'create',
    params: {},
    run: ctx => controller.create(ctx, { kind: 'tent', name: 'One more', roomId: ROOM }),
  },
  { name: 'read', handler: 'read', params: { id: SPACE }, run: () => controller.read(SPACE) },
  { name: 'update', handler: 'update', params: { id: SPACE }, run: ctx => controller.update(ctx, SPACE, { name: 'Renamed' }) },
  { name: 'archive', handler: 'archive', params: { id: SPACE }, run: () => controller.archive(SPACE) },
  { name: 'unarchive', handler: 'unarchive', params: { id: SPACE }, run: () => controller.unarchive(SPACE) },
  { name: 'delete', handler: 'remove', params: { id: SPACE }, run: () => controller.remove(SPACE) },
  {
    name: 'place a device',
    handler: 'placeDevice',
    params: { id: SPACE, deviceId: DEVICE },
    run: ctx => controller.placeDevice(ctx, SPACE, DEVICE),
  },
  {
    name: 'take a device out',
    handler: 'removeDevice',
    params: { id: SPACE, deviceId: DEVICE },
    setUp: () => db.devices.updateOne({ id: DEVICE }, { $set: { spaceId: SPACE } }),
    run: ctx => controller.removeDevice(ctx, SPACE, DEVICE),
  },
  {
    name: 'apply a preset',
    handler: 'applyPreset',
    params: { id: SPACE },
    run: ctx => controller.applyPreset(ctx, SPACE, { stage: 'vegetative' }),
  },
];

const EVERY_ROUTE = ROUTES.map(route => route.name);

/** What a refusal to decide about the caller looks like; anything else is the route refusing for its own reasons. */
const DENIALS = new Set(['space_not_found', 'device_not_found', 'insufficient_access', 'no_account']);

const executionContext = (route: RouteCase, ctx: AccessContext): ExecutionContext =>
  ({
    getHandler: () => SpacesController.prototype[route.handler],
    getClass: () => SpacesController,
    switchToHttp: () => ({
      getRequest: () => ({
        params: route.params,
        headers: {},
        query: {},
        ...(ctx.userId === null ? {} : { auth: { userId: ctx.userId, isAdmin: ctx.isAdmin, isDemo: ctx.isDemo } }),
      }),
    }),
  }) as unknown as ExecutionContext;

const allowedRoutes = async (ctx: AccessContext): Promise<string[]> => {
  const allowed: string[] = [];

  for (const route of ROUTES) {
    await db.reset();
    await seed();
    await route.setUp?.();

    try {
      await guard.canActivate(executionContext(route, ctx));
      await route.run(ctx);
      allowed.push(route.name);
    } catch (error) {
      if (!(error instanceof ProblemException) || !DENIALS.has(error.problem.code)) throw error;
    }
  }

  return allowed;
};

describe('who may do what', () => {
  it('lets the owner do everything', async () => {
    expect(await allowedRoutes(session(OWNER))).toEqual(EVERY_ROUTE);
  });

  it('lets an administrator do everything', async () => {
    expect(await allowedRoutes(admin)).toEqual(EVERY_ROUTE);
  });

  it('lets a manager do everything but end a space', async () => {
    expect(await allowedRoutes(session(MANAGER))).toEqual(EVERY_ROUTE.filter(name => name !== 'delete'));
  });

  it('lets a member read the space and change nothing', async () => {
    expect(await allowedRoutes(session(MEMBER))).toEqual(['read']);
  });

  it('tells a stranger nothing', async () => {
    expect(await allowedRoutes(session(STRANGER))).toEqual([]);
  });

  it('tells a demo session nothing, because none of this is demo', async () => {
    expect(await allowedRoutes(demo)).toEqual([]);
  });

  it('declares a need on every route about one space, so none is left undecided', () => {
    const needs = ROUTES.filter(route => 'id' in route.params).map(route => ({
      name: route.name,
      ...(new Reflector().get<{ need: string }>('v1:access', SpacesController.prototype[route.handler]) ?? {}),
    }));

    expect(needs).toEqual([
      { name: 'read', need: 'view', subject: 'space', param: 'id' },
      { name: 'update', need: 'manage', subject: 'space', param: 'id' },
      { name: 'archive', need: 'manage', subject: 'space', param: 'id' },
      { name: 'unarchive', need: 'manage', subject: 'space', param: 'id' },
      { name: 'delete', need: 'own', subject: 'space', param: 'id' },
      { name: 'place a device', need: 'manage', subject: 'space', param: 'id' },
      { name: 'take a device out', need: 'manage', subject: 'space', param: 'id' },
      { name: 'apply a preset', need: 'manage', subject: 'space', param: 'id' },
    ]);
  });
});
