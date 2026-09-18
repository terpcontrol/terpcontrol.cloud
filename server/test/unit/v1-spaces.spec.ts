import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from '@common/v1/access.guard';
import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { DataService } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
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
let controller: SpacesController;
let guard: AccessGuard;

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

beforeEach(async () => {
  await db.reset();
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  spaces = new SpacesService(db.spaces, db.memberships, db.invites, db.devices, db.cameras, db.grows, devices, access);
  controller = new SpacesController(spaces, new SpaceLiveService(db.devices, db.cameras, {} as DataService), access);
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
    ]);
  });
});
