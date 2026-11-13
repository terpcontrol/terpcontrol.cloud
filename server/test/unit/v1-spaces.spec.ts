import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';
import { AccessGuard } from '@common/v1/access.guard';
import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { DataService } from '@modules/data/data.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { DeviceConfigurationWriter } from '@modules/v1/plan/device-configuration.port';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { MailService } from '@modules/mail/mail.service';
import { ClimatePresetsService } from '@modules/v1/space/climate-presets.service';
import { Co2ReportService } from '@modules/v1/space/co2-report.service';
import { PresetApplicationsService } from '@modules/v1/space/preset-applications.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesController } from '@modules/v1/space/spaces.controller';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { InvitesService } from '@modules/v1/members/invites.service';
import { MembersService } from '@modules/v1/members/members.service';
import { admin, demo, session } from './support/callers';
import { accessOn, growsOn, spacesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';
import { standingIn } from './support/placed';

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

const db = useV1TestDatabase();
let access: AccessService;
let spaces: SpacesService;
let members: MembersService;
let invites: InvitesService;
let presets: PresetApplicationsService;
let controller: SpacesController;
let guard: AccessGuard;

/** What was sent to a device, since a unit suite has no broker to send it over. */
let configured: { deviceId: string; settings: DeviceConfiguration; stage?: string | null }[];

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
  await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, ...standingIn(OTHER_SPACE, new Date('2026-01-03T00:00:00.000Z')) });
};

/** A rhythm, without what it is about. */
const RHYTHM = { kind: 'chore', label: 'Clean the filter', everyDays: 7, onceAt: null, createdBy: OWNER } as const;

const refusal = async (action: () => unknown): Promise<ProblemException> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error('It was allowed.');
};

/**
 * The preset half of this controller, built for real against the same database:
 * what is asked of it here is who may apply one, and that decision is the
 * guard's rather than the service's. Nothing is sent to a device, because there
 * is no broker in a unit suite.
 */
const presetsOf = (): PresetApplicationsService => {
  const written = new EntryWriterService(db.entries);
  const phases = new PhaseWriterService(db.grows, written, db.entries, db.devices);
  const configuration: DeviceConfigurationWriter = {
    applyConfiguration: async (deviceId, settings, stage) => {
      configured.push({ deviceId, settings, stage });
      return true;
    },
  };
  const grows = growsOn(db, access, { phases, writer: written });
  const plans = new PlanService(
    db.plans,
    db.devices,
    new PlanProgressService(db.plans, db.devices, db.users, written, phases, { send: async () => undefined } as unknown as MailService),
  );

  return new PresetApplicationsService(db.devices, new ClimatePresetsService(db.devices, configuration), spaces, phases, plans, grows, access);
};

beforeEach(async () => {
  await db.reset();
  access = accessOn(db);
  spaces = spacesOn(db, access);
  members = new MembersService(db.memberships, db.spaces, db.users, db.invites, db.grows, db.entries, access, spaces);
  invites = new InvitesService(db.invites, db.spaces, db.users, members, spaces, access);
  configured = [];
  presets = presetsOf();
  controller = new SpacesController(
    spaces,
    new SpaceLiveService(db.devices, db.cameras, {} as DataService),
    presets,
    access,
    new Co2ReportService(db.entries, db.devices, {} as DataService),
  );
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

  it('refuses a room made by itself: a room is a field of the place', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'room', name: 'Cellar' }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'room_by_itself' });
  });

  it('makes the room a place names, and puts the next place that names it into the same one', async () => {
    const first = await spaces.create(session(STRANGER), { kind: 'tent', name: 'Tent', roomName: 'Cellar' });
    const second = await spaces.create(session(STRANGER), { kind: 'fridge', name: 'Fridge', roomName: '  cellar ' });

    expect(first.roomId).not.toBeNull();
    expect(second.roomId).toBe(first.roomId);
    expect(await db.spaces.findOne({ id: first.roomId }).lean()).toMatchObject({ ownerId: STRANGER, kind: 'room', name: 'Cellar', archivedAt: null });
  });

  it('refuses a room named twice over, by id and by name', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'tent', name: 'Nested', roomId: ROOM, roomName: 'Cellar' }));

    expect(problem.problem).toMatchObject({ status: 422, code: 'two_rooms' });
  });

  it('refuses a second place of one name with a sentence, however it is typed', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'fridge', name: '  the TENT ' }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'name_taken', detail: 'Another place is already called "The tent".' });
  });

  it('lets a place be called what a room is called, and what somebody else´s place is', async () => {
    expect((await spaces.create(session(OWNER), { kind: 'tent', name: 'The room' })).name).toBe('The room');
    expect((await spaces.create(session(STRANGER), { kind: 'tent', name: 'The tent' })).name).toBe('The tent');
  });

  it('refuses a name of nothing but blanks', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'tent', name: '   ' }));

    expect(problem.problem).toMatchObject({ status: 422, code: 'name_required' });
  });

  it('refuses to group a space under something that is not a room', async () => {
    const problem = await refusal(() => spaces.create(session(OWNER), { kind: 'tent', name: 'Nested', roomId: SPACE }));

    expect(problem.problem).toMatchObject({ status: 422, code: 'not_a_room' });
  });

  it('is not something a session without an account can do', async () => {
    const problem = await refusal(() => spaces.create(demo(), { kind: 'tent', name: 'Mine now' }));

    expect(problem.problem.code).toBe('no_account');
  });
});

describe('changing one', () => {
  it('renames it and leaves everything else alone', async () => {
    const changed = await spaces.update(session(OWNER), SPACE, { name: 'The big tent' });

    expect(changed).toMatchObject({ name: 'The big tent', kind: 'tent', roomId: ROOM });
  });

  it('moves it into a room of its owner', async () => {
    const loose = await spaces.create(session(OWNER), { kind: 'balcony', name: 'The balcony' });
    const moved = await spaces.update(session(OWNER), loose.id, { roomId: ROOM });

    expect(moved.roomId).toBe(ROOM);
  });

  /**
   * Which room a place stands in is who is let into it, and taking the last
   * place out of a room ends the room with its members. A guest who manages the
   * place renames it and changes its kind; the grouping is its owner's.
   */
  it('leaves the room of a place to its owner: a guest who manages it sets none, by id, by name or by taking it out', async () => {
    for (const body of [{ roomId: null }, { roomName: 'Attic' }, { roomName: 'The room' }]) {
      const problem = await refusal(() => spaces.update(session(MANAGER), SPACE, body));
      expect(problem.problem).toMatchObject({ status: 403, code: 'insufficient_access' });
    }
    expect((await spaces.require(SPACE)).roomId).toBe(ROOM);
    expect(await db.spaces.countDocuments({ kind: 'room' })).toBe(1);

    // Naming the room it stands in already sets nothing, and the rest of the form is the manager's.
    expect(await spaces.update(session(MANAGER), SPACE, { name: 'Renamed', kind: 'fridge', roomId: ROOM })).toMatchObject({
      name: 'Renamed',
      kind: 'fridge',
      roomId: ROOM,
    });
    expect((await spaces.update(session(OWNER), SPACE, { roomId: null })).roomId).toBeNull();
  });

  it('refuses a room of another account, because a room and its spaces are shared as one', async () => {
    const theirs = await spaces.create(session(STRANGER), { kind: 'tent', name: 'Their tent', roomName: 'Their room' });
    const problem = await refusal(() => spaces.update(admin(), SPACE, { roomId: theirs.roomId }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'room_of_another_account' });
  });

  it('refuses to group a space under itself', async () => {
    const problem = await refusal(() => spaces.update(session(OWNER), SPACE, { roomId: SPACE }));

    expect(problem.problem.code).toBe('room_in_room');
  });

  it('refuses to turn a place into a room, or a room into a place', async () => {
    expect((await refusal(() => spaces.update(session(OWNER), SPACE, { kind: 'room' }))).problem.code).toBe('room_by_itself');
    expect((await refusal(() => spaces.update(session(OWNER), ROOM, { kind: 'tent' }))).problem.code).toBe('room_by_itself');
  });

  it('refuses a name another of the owner´s places carries, and takes its own name again', async () => {
    const problem = await refusal(() => spaces.update(session(OWNER), SPACE, { name: 'the other tent' }));

    expect(problem.problem).toMatchObject({ status: 409, code: 'name_taken', detail: 'Another place is already called "The other tent".' });
    expect((await spaces.update(session(OWNER), SPACE, { name: 'THE TENT' })).name).toBe('THE TENT');
  });

  it('renames a room, and refuses it the name of another room', async () => {
    await spaces.update(session(OWNER), SPACE, { roomName: 'Attic' });

    expect((await spaces.update(session(OWNER), ROOM, { name: 'Cellar' })).name).toBe('Cellar');
    expect((await refusal(() => spaces.update(session(OWNER), ROOM, { name: 'attic' }))).problem).toMatchObject({
      code: 'name_taken',
      detail: 'Another room is already called "Attic".',
    });
  });

  it('puts a place into a room by name, making the room where there is none', async () => {
    const moved = await spaces.update(session(OWNER), SPACE, { roomName: 'Attic' });

    expect(moved.roomId).not.toBe(ROOM);
    expect(await db.spaces.findOne({ id: moved.roomId }).lean()).toMatchObject({ ownerId: OWNER, kind: 'room', name: 'Attic' });
    // Its old room still holds the other tent and a member, and stays.
    expect((await spaces.require(ROOM)).archivedAt).toBeNull();
  });
});

describe('a room that empties', () => {
  /** A room of the owner's with one tent in it and nobody a member. */
  const attic = async (): Promise<{ roomId: string; tentId: string }> => {
    const tent = await spaces.create(session(OWNER), { kind: 'tent', name: 'Attic tent', roomName: 'Attic' });
    return { roomId: tent.roomId!, tentId: tent.id };
  };

  it('ends when its last place is taken out, with its invites and share links', async () => {
    const { roomId, tentId } = await attic();
    await db.invites.create({ id: 'invite-attic', code: 'ATTIC234', spaceId: roomId, role: 'can_log', createdBy: OWNER });
    await db.shareLinks.create({ id: 'link-attic', token: 'token-attic', kind: 'view', subject: { type: 'space', id: roomId }, createdBy: OWNER });
    await db.reminders.create({ ...RHYTHM, id: 'reminder-attic', subject: { type: 'space', id: roomId } });

    await spaces.update(session(OWNER), tentId, { roomId: null });

    expect((await spaces.require(roomId)).archivedAt).not.toBeNull();
    expect(await db.invites.countDocuments({ spaceId: roomId })).toBe(0);
    expect(await db.shareLinks.countDocuments({ 'subject.id': roomId })).toBe(0);
    expect(await db.reminders.countDocuments({})).toBe(0);
  });

  it('ends when its last place ends or is put away, and that place stands in no room when it is brought back', async () => {
    const { roomId, tentId } = await attic();
    await spaces.archive(session(OWNER), tentId, true);

    expect((await spaces.require(roomId)).archivedAt).not.toBeNull();
    expect((await spaces.archive(session(OWNER), tentId, false)).roomId).toBeNull();

    const other = await spaces.create(session(OWNER), { kind: 'tent', name: 'Loft tent', roomName: 'Loft' });
    await spaces.remove(other.id);
    expect((await spaces.require(other.roomId!)).archivedAt).not.toBeNull();
  });

  it('never outlives its places: it ends with the last of them, and its members´ way in with it', async () => {
    const { roomId, tentId } = await attic();
    await db.memberships.create({ id: 'membership-attic', spaceId: roomId, userId: MEMBER, role: 'can_log' });

    await spaces.update(session(OWNER), tentId, { roomId: null });

    expect((await spaces.require(roomId)).archivedAt).not.toBeNull();
    expect(await db.memberships.countDocuments({ spaceId: roomId })).toBe(0);
    // The member's own row on a tent is another way in and is untouched.
    expect(await db.memberships.countDocuments({ id: 'membership-member' })).toBe(1);
  });

  it('stays while a room holds something itself, though no place stands in it', async () => {
    const { roomId, tentId } = await attic();
    await db.cameras.create({ id: 'camera-attic', ownerId: OWNER, kind: 'rtsp', name: 'Attic cam', spaceId: roomId });

    await spaces.update(session(OWNER), tentId, { roomId: null });

    expect((await spaces.require(roomId)).archivedAt).toBeNull();
  });

  it('stays while a place stands in it', async () => {
    await spaces.update(session(OWNER), SPACE, { roomId: null });

    expect((await spaces.require(ROOM)).archivedAt).toBeNull();
  });

  it('makes a new room of a name whose room has ended', async () => {
    const { roomId, tentId } = await attic();
    await spaces.update(session(OWNER), tentId, { roomId: null });

    const moved = await spaces.update(session(OWNER), tentId, { roomName: 'Attic' });
    expect(moved.roomId).not.toBe(roomId);
    expect((await spaces.require(moved.roomId!)).archivedAt).toBeNull();
  });

  /**
   * An ended room is a tombstone history names and nothing else. Whatever it
   * took - a new name, a place, a person - would be written to something on no
   * screen, so its owner is refused each of them with the rule in a sentence.
   */
  describe('once it has ended', () => {
    const ENDED = {
      status: 409,
      code: 'room_ended',
      detail: 'A room exists only while a place stands in it, and this one ended with its last place.',
    };
    let roomId: string;
    let tentId: string;

    beforeEach(async () => {
      ({ roomId, tentId } = await attic());
      await spaces.update(session(OWNER), tentId, { roomId: null });
    });

    it('takes no new name', async () => {
      expect((await refusal(() => spaces.update(session(OWNER), roomId, { name: 'Loft' }))).problem).toMatchObject(ENDED);
      expect((await spaces.require(roomId)).name).toBe('Attic');
    });

    it('takes no place, neither one that moves nor one that is made', async () => {
      expect((await refusal(() => spaces.update(session(OWNER), tentId, { roomId }))).problem).toMatchObject(ENDED);
      expect((await refusal(() => spaces.create(session(OWNER), { kind: 'tent', name: 'Late tent', roomId }))).problem).toMatchObject(ENDED);
      expect(await db.spaces.countDocuments({ roomId })).toBe(0);
    });

    it('takes nobody: no invite is cut for it and nobody is added to it', async () => {
      await db.users.create({ id: MEMBER, email: 'member@test.invalid', handle: 'member', passwordHash: 'x', isActive: true });

      expect((await refusal(() => invites.create(session(OWNER), roomId, { role: 'can_log' }))).problem).toMatchObject(ENDED);
      expect((await refusal(() => members.add(session(OWNER), roomId, { handle: 'member', role: 'can_log' }))).problem).toMatchObject(ENDED);
      expect(await db.invites.countDocuments({ spaceId: roomId })).toBe(0);
      expect(await db.memberships.countDocuments({ spaceId: roomId })).toBe(0);
      // The same two on a room that stands are taken, so the refusal is the ended room's.
      await invites.create(session(OWNER), ROOM, { role: 'can_log' });
      await members.add(session(OWNER), ROOM, { handle: 'member', role: 'can_log' });
    });

    it('lets nobody in through a code that was cut for it, which answers as any dead code does', async () => {
      await db.invites.create({ id: 'invite-late', code: 'LATE2345', spaceId: roomId, role: 'can_log', createdBy: OWNER });

      expect((await refusal(() => invites.accept(session(STRANGER), 'LATE2345'))).problem).toMatchObject({ status: 404, code: 'invite_not_found' });
      expect((await invites.preview('LATE2345')).isValid).toBe(false);
      expect(await db.memberships.countDocuments({ spaceId: roomId })).toBe(0);
    });
  });
});

describe('listing them', () => {
  it('leaves archived spaces out, and lists them when they are asked for', async () => {
    await spaces.archive(session(OWNER), SPACE, true);

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

  /**
   * An administrator's home screen is their own tents. `access()` still lets the
   * office at any named space - that is how a reported device gets opened - but
   * a listing is what a person reads about their own places.
   */
  it('shows an administrator their own spaces and none of a stranger´s', async () => {
    await db.spaces.create({ id: 'space-theirs', ownerId: STRANGER, kind: 'tent', name: 'Theirs', createdAt: new Date('2026-01-04T00:00:00.000Z') });

    const page = await spaces.list(admin(OWNER), {}, {});

    expect(page.items.map(space => space.id)).not.toContain('space-theirs');
    expect(page.items.map(space => space.id)).toEqual([ROOM, SPACE, OTHER_SPACE]);
  });

  it('shows a demo session the demo spaces, and nobody´s real ones', async () => {
    await db.spaces.create({ id: 'space-demo', ownerId: 'user-tour', kind: 'tent', name: 'The demo tent', isDemo: true });

    expect((await spaces.list(demo(), {}, {})).items.map(space => space.id)).toEqual(['space-demo']);
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

describe('what the reader may do here', () => {
  /**
   * The field exists so a screen draws only what the server would allow, so the
   * thing to assert is that the two agree: every answer below is checked
   * against `access()` rather than against what the setup says, because a
   * `youMay` that is merely plausible is what would put a refused button on a
   * guest's screen.
   */
  const asked = async (ctx: AccessContext, spaceId: string) => (await spaces.list(ctx, {}, {})).items.find(space => space.id === spaceId);

  it('tells the owner they own it and the manager of the room that they manage every tent in it', async () => {
    expect((await asked(session(OWNER), SPACE))?.youMay).toBe('own');
    expect((await asked(session(MANAGER), SPACE))?.youMay).toBe('manage');
    expect((await asked(session(MANAGER), OTHER_SPACE))?.youMay).toBe('manage');
  });

  it('tells somebody who may only write in one tent exactly that, and nothing about the other', async () => {
    expect((await asked(session(MEMBER), SPACE))?.youMay).toBe('log');
    // Not "view": a tent they are not in is not in their list at all.
    expect(await asked(session(MEMBER), OTHER_SPACE)).toBeUndefined();
  });

  it('agrees with access() for every caller, which is the only reason it can be drawn from', async () => {
    for (const ctx of [session(OWNER), session(MANAGER), session(MEMBER), admin()]) {
      const space = await spaces.require(SPACE);
      const may = await spaces.mayIn1(ctx, space);
      const ref = { type: 'space' as const, id: SPACE };

      expect(await access.access(ctx, ref, 'manage')).toEqual(may === 'own' || may === 'manage' ? expect.anything() : null);
      expect(await access.access(ctx, ref, 'own')).toEqual(may === 'own' ? expect.anything() : null);
    }
  });

  it('says only "view" to a session that is nobody in particular', async () => {
    const space = await spaces.require(SPACE);

    expect(await spaces.mayIn1(session(STRANGER), space)).toBe('view');
    expect(await spaces.mayIn1(demo(), space)).toBe('view');
  });
});

describe('archiving one', () => {
  it('says the same thing twice without moving the instant it carries', async () => {
    const archived = await spaces.archive(session(OWNER), SPACE, true);
    const again = await spaces.archive(session(OWNER), SPACE, true);

    expect(archived.archivedAt).not.toBeNull();
    expect(again.archivedAt).toBe(archived.archivedAt);
  });

  it('brings it back', async () => {
    await spaces.archive(session(OWNER), SPACE, true);

    expect((await spaces.archive(session(OWNER), SPACE, false)).archivedAt).toBeNull();
  });

  it('refuses a room: it is neither put away nor brought back by itself', async () => {
    expect((await refusal(() => spaces.archive(session(OWNER), ROOM, true))).problem).toMatchObject({ status: 409, code: 'room_by_itself' });
    expect((await refusal(() => spaces.archive(session(OWNER), ROOM, false))).problem.code).toBe('room_by_itself');
  });

  it('refuses to bring a place back under a name another has taken since', async () => {
    await spaces.archive(session(OWNER), SPACE, true);
    await spaces.create(session(OWNER), { kind: 'tent', name: 'The tent' });

    expect((await refusal(() => spaces.archive(session(OWNER), SPACE, false))).problem.code).toBe('name_taken');
  });
});

describe('ending one', () => {
  const codesOf = (problem: ProblemException): string[] => problem.problem.errors.map(error => error.code);

  it('keeps the space as a tombstone, because history still names it', async () => {
    await spaces.remove(SPACE);

    expect((await spaces.list(session(OWNER), {}, {})).items.map(space => space.id)).toEqual([ROOM, OTHER_SPACE]);
    expect((await spaces.require(SPACE)).archivedAt).not.toBeNull();
  });

  /**
   * Guests do not block the removal: the app names them before it asks, and
   * the write that ends the place ends every way into it - as a room's end
   * does. A way in that outlived the place would open a tombstone.
   */
  it('ends its guests´ memberships, its invites and its share links with it', async () => {
    await db.memberships.create({ id: 'membership-second', spaceId: SPACE, userId: STRANGER, role: 'can_manage' });
    await db.invites.create({ id: 'invite-1', code: 'ABCD2345', spaceId: SPACE, role: 'can_log', createdBy: OWNER });
    await db.shareLinks.create({ id: 'link-1', token: 'token-1', kind: 'view', subject: { type: 'space', id: SPACE }, createdBy: OWNER });

    await spaces.remove(SPACE);

    expect((await spaces.require(SPACE)).archivedAt).not.toBeNull();
    expect(await db.memberships.countDocuments({ spaceId: SPACE })).toBe(0);
    expect(await db.invites.countDocuments({ spaceId: SPACE })).toBe(0);
    expect(await db.shareLinks.countDocuments({ 'subject.id': SPACE })).toBe(0);
    // Neither guest reaches it any more, and the one who could log has no place left.
    expect(await access.access(session(STRANGER), { type: 'space', id: SPACE }, 'view')).toBeNull();
    expect((await spaces.list(session(MEMBER), {}, { archived: true })).items).toEqual([]);
  });

  /**
   * A rhythm kept for the place ends with it: work cannot fall due in a place
   * that is gone, and a reminder naming one could not be changed by anybody.
   * A grow's reminders are the grow's, and another place's are that place's.
   */
  it('ends the reminders kept for it, and no grow´s and no other place´s', async () => {
    await db.reminders.create([
      { ...RHYTHM, id: 'reminder-here', subject: { type: 'space', id: SPACE } },
      { ...RHYTHM, id: 'reminder-next-door', subject: { type: 'space', id: OTHER_SPACE } },
      // A grow's, though its id is the place's: the kind of subject decides.
      { ...RHYTHM, id: 'reminder-of-a-grow', subject: { type: 'grow', id: SPACE } },
    ]);

    await spaces.remove(SPACE);

    expect((await db.reminders.find({}).lean()).map(reminder => reminder.id).sort()).toEqual(['reminder-next-door', 'reminder-of-a-grow']);
  });

  /**
   * A membership on the room reaches into the tents under it, but it is the
   * room's: it stays while another place stands in the room, and goes with the
   * room when the last one ends.
   */
  it('leaves a membership held on the room above it while another place stands there', async () => {
    await spaces.remove(SPACE);

    expect(await db.memberships.countDocuments({ spaceId: ROOM })).toBe(1);
    expect((await spaces.require(ROOM)).archivedAt).toBeNull();
  });

  it('ends the room with its last place, and the room´s members´ rows with it', async () => {
    await db.devices.deleteMany({ spaceId: OTHER_SPACE });
    await spaces.remove(SPACE);
    await spaces.remove(OTHER_SPACE);

    expect((await spaces.require(ROOM)).archivedAt).not.toBeNull();
    expect(await db.memberships.countDocuments({})).toBe(0);
    expect(await access.access(session(MANAGER), { type: 'space', id: OTHER_SPACE }, 'view')).toBeNull();
  });

  it('refuses the room itself: a room ends by itself', async () => {
    await db.spaces.updateMany({ roomId: ROOM }, { $set: { roomId: null } });

    expect((await refusal(() => spaces.remove(ROOM))).problem).toMatchObject({ status: 409, code: 'room_by_itself' });
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

  it('names everything that is in the way at once, rather than the first thing', async () => {
    await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_standalone', name: 'The cam', spaceId: SPACE });

    await db.devices.updateOne({ id: DEVICE }, { $set: standingIn(SPACE) });

    const problem = await refusal(() => spaces.remove(SPACE));
    expect(codesOf(problem)).toEqual(['device_here', 'camera_here']);
    // Refused and unchanged: the people in it are still in it.
    expect(await db.memberships.countDocuments({ spaceId: SPACE })).toBe(1);
    expect((await spaces.require(SPACE)).archivedAt).toBeNull();
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

  it('allows it once the grow standing in it has ended', async () => {
    await db.grows.create({
      id: GROW,
      ownerId: OWNER,
      name: 'The grow',
      type: 'photoperiod',
      slug: 'the-grow',
      placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: new Date('2026-01-05T00:00:00.000Z'), endedAt: null, plantIds: null }],
      startedAt: new Date('2026-01-05T00:00:00.000Z'),
      endedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    await spaces.remove(SPACE);
    expect((await db.spaces.findOne({ id: SPACE }).lean())?.archivedAt).not.toBeNull();
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
    expect((await spaces.require(SPACE)).archivedAt).not.toBeNull();
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

  it('keeps where the device stood: the stay it leaves is closed and the one it comes to is open', async () => {
    await spaces.placeDevice(SPACE, DEVICE, false);

    const { placements } = (await db.devices.findOne({ id: DEVICE }).lean())!;
    expect(placements.map(placement => placement.spaceId)).toEqual([OTHER_SPACE, SPACE]);
    expect(placements[0].endedAt).toEqual(placements[1].startedAt);
    expect(placements[1].endedAt).toBeNull();
  });

  it('takes a move back as if it had not happened: a stay of minutes is no stay', async () => {
    await spaces.placeDevice(SPACE, DEVICE, false);
    await spaces.placeDevice(OTHER_SPACE, DEVICE, false);

    const { placements } = (await db.devices.findOne({ id: DEVICE }).lean())!;
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ spaceId: OTHER_SPACE, startedAt: new Date('2026-01-03T00:00:00.000Z'), endedAt: null });
  });

  it('refuses a device of another account, however much its owner may manage the place', async () => {
    // The manager of the room may steer every tent in it; hardware of their own does not stand in the host's tent.
    await db.devices.create({ id: 'device-of-the-manager', type: 'fan', ownerId: MANAGER, spaceId: null, placements: [] });

    const problem = await refusal(() => spaces.placeDevice(SPACE, 'device-of-the-manager', false));

    expect(problem.problem).toMatchObject({ status: 409, code: 'place_of_another_account' });
    expect(problem.problem.detail).toBe('A device stands only in a place of the account it belongs to.');
    expect(await db.devices.findOne({ id: 'device-of-the-manager' }).lean()).toMatchObject({ spaceId: null, placements: [] });
  });

  it('refuses to put a device into a room', async () => {
    expect((await refusal(() => spaces.placeDevice(ROOM, DEVICE, false))).problem.code).toBe('room_by_itself');
  });

  it('refuses to take a device out of a space it is not in', async () => {
    const problem = await refusal(() => spaces.removeDevice(SPACE, DEVICE));

    expect(problem.problem).toMatchObject({ status: 404, code: 'device_not_here' });
  });

  it('refuses to put anything into a space that has ended', async () => {
    await spaces.archive(session(OWNER), SPACE, true);
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

/**
 * A controller with the CO2 sensor the preset's CO2 row needs. One that reports
 * none holds its target at zero whatever it is told, so the row is left out for
 * it - which is its own case below.
 */
const aController = (spaceId: string | null = SPACE, configuration: DeviceConfiguration | null = TUNED, co2: 'on' | 'off' = 'on') =>
  db.devices.create({ id: CONTROLLER, type: 'controller', ownerId: OWNER, spaceId, configuration, state: { hardware: { co2 } } });

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

describe('the work mode of a stage entered without its climate', () => {
  const modeFor = (stage: GrowthStage) =>
    new ClimatePresetsService(db.devices, {
      applyConfiguration: async (deviceId, settings, given) => {
        configured.push({ deviceId, settings, stage: given });
        return true;
      },
    }).modeToSpace(SPACE, stage);

  it('puts a device into drying with nothing but the stage, and leaves one that dries already alone', async () => {
    await aController(SPACE, { ...TUNED, workmode: 'small' });
    await modeFor('drying');
    expect(configured).toEqual([{ deviceId: CONTROLLER, settings: {}, stage: 'drying' }]);

    configured = [];
    await db.devices.updateOne({ id: CONTROLLER }, { $set: { 'configuration.workmode': 'dry' } });
    await modeFor('drying');
    expect(configured).toEqual([]);
  });

  it('ends a drying spell or an off for another stage, and writes nothing to a device that already runs', async () => {
    await aController(SPACE, { ...TUNED, workmode: 'dry' });
    await modeFor('curing');
    expect(configured).toEqual([{ deviceId: CONTROLLER, settings: {}, stage: 'curing' }]);

    configured = [];
    await db.devices.updateOne({ id: CONTROLLER }, { $set: { 'configuration.workmode': 'small' } });
    await modeFor('flowering');
    expect(configured).toEqual([]);
  });
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

  /**
   * The firmware of a controller that reports no CO2 sensor forces the target to
   * zero as it reads the document, so a preset writing one left the cloud holding
   * and showing 1000 ppm for hardware running nothing - on a tab whose manual
   * targets page draws that row dead. The section it already had is kept; the
   * figure is simply not put there.
   */
  it('writes no CO2 target to a controller that reports no sensor, and leaves the section it had alone', async () => {
    await aController(SPACE, TUNED, 'off');
    const applied = await presets.apply(session(OWNER), SPACE, { stage: 'vegetative' });

    expect(applied.deviceIds).toEqual([CONTROLLER]);
    expect(configured[0].settings.co2).toBeUndefined();
    expect(configured[0].settings).toMatchObject({ day: { temperature: 26, humidity: 62 }, lights: { limit: 80 } });

    const stored = await db.devices.findOne({ id: CONTROLLER }).lean();
    expect(stored?.configuration?.co2).toEqual({ target: 300 });
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
    // Still enriched, if less than flower's 1000, rather than back to outdoor air.
    expect(configured[0].settings.co2).toEqual({ target: 600 });
  });

  it('keeps an autoflower under a long day in flower, because it never gets the 12/12 flip', async () => {
    await aController();
    await presets.apply(session(OWNER), SPACE, { stage: 'flowering', preset: 'autoflower' });

    // Eighteen hours from 06:00 is midnight UTC, written as the second before it so the evening ramp runs.
    expect(configured[0].settings).toMatchObject({ daynight: { day: 21600, night: 86399 }, day: { temperature: 25 } });
    expect(configured[0].settings.daynight).not.toMatchObject({ night: 21600 + 12 * 60 * 60 });
  });

  it('names the stage it writes for, which is what puts the device into its drying mode', async () => {
    await aController();
    await presets.apply(session(OWNER), SPACE, { stage: 'drying' });

    expect(configured[0].stage).toBe('drying');
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
  { name: 'read', handler: 'read', params: { id: SPACE }, run: ctx => controller.read(ctx, SPACE) },
  { name: 'update', handler: 'update', params: { id: SPACE }, run: ctx => controller.update(ctx, SPACE, { name: 'Renamed' }) },
  { name: 'archive', handler: 'archive', params: { id: SPACE }, run: ctx => controller.archive(ctx, SPACE) },
  { name: 'unarchive', handler: 'unarchive', params: { id: SPACE }, run: ctx => controller.unarchive(ctx, SPACE) },
  // The room a place stands in is who is let into it, which is its owner's to say.
  { name: 'regroup', handler: 'update', params: { id: SPACE }, run: ctx => controller.update(ctx, SPACE, { roomId: null }) },
  { name: 'name its room', handler: 'update', params: { id: SPACE }, run: ctx => controller.update(ctx, SPACE, { roomName: 'Attic' }) },
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
    expect(await allowedRoutes(admin())).toEqual(EVERY_ROUTE);
  });

  /** What is the owner's stays the owner's: ending the place, saying which room it stands in, and taking a device out of every place. */
  const THE_OWNERS = ['regroup', 'name its room', 'delete', 'take a device out'];

  it('lets a manager do everything but what is the owner´s', async () => {
    expect(await allowedRoutes(session(MANAGER))).toEqual(EVERY_ROUTE.filter(name => !THE_OWNERS.includes(name)));
  });

  it('refuses a manager taking a device out with a 403, and leaves the device where it stands', async () => {
    await db.devices.updateOne({ id: DEVICE }, { $set: standingIn(SPACE) });
    const route = ROUTES.find(one => one.name === 'take a device out')!;

    expect(await guard.canActivate(executionContext(route, session(MANAGER)))).toBe(true);
    expect((await refusal(() => route.run(session(MANAGER)))).problem).toMatchObject({ status: 403, code: 'insufficient_access' });
    expect((await db.devices.findOne({ id: DEVICE }).lean())?.spaceId).toBe(SPACE);
    expect((await refusal(() => guard.canActivate(executionContext(route, session(STRANGER))))).problem).toMatchObject({ status: 404 });
  });

  it('lets a member read the space and change nothing', async () => {
    expect(await allowedRoutes(session(MEMBER))).toEqual(['read']);
  });

  it('tells a stranger nothing', async () => {
    expect(await allowedRoutes(session(STRANGER))).toEqual([]);
  });

  it('tells a demo session nothing, because none of this is demo', async () => {
    expect(await allowedRoutes(demo())).toEqual([]);
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
      { name: 'regroup', need: 'manage', subject: 'space', param: 'id' },
      { name: 'name its room', need: 'manage', subject: 'space', param: 'id' },
      { name: 'delete', need: 'own', subject: 'space', param: 'id' },
      { name: 'place a device', need: 'manage', subject: 'space', param: 'id' },
      { name: 'take a device out', need: 'manage', subject: 'space', param: 'id' },
      { name: 'apply a preset', need: 'manage', subject: 'space', param: 'id' },
    ]);
  });
});
