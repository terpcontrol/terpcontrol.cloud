import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { DevicesService } from '@modules/v1/device/devices.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Which devices a caller is shown.
 *
 * The list decides with one filter and `access()` decides one device at a time,
 * and the two have to agree: a person who is shown no device in the list must
 * also be refused that device by id, and the other way round. They are written
 * separately, so this is where they are held against each other.
 */

const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const TENT = 'space-tent';
const BALCONY = 'space-balcony';
const IN_THE_TENT = 'device-in-the-tent';
const ON_THE_BALCONY = 'device-on-the-balcony';

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };

let db: V1TestDatabase;
let devices: DevicesService;

const build = (): DevicesService => {
  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);

  return new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
};

/**
 * A tent standing in a room and a balcony standing on its own, with a
 * controller in each: the manager holds the room and nothing else, so the
 * balcony is what proves the room does not widen to everything the owner has.
 */
const world = async (): Promise<void> => {
  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'Grow room', roomId: null },
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: ROOM },
    { id: BALCONY, ownerId: OWNER, kind: 'balcony', name: 'Balcony', roomId: null },
  ]);

  await db.devices.create([
    { id: IN_THE_TENT, type: 'controller', ownerId: OWNER, spaceId: TENT, createdAt: new Date('2026-01-03T12:00:00.000Z') },
    { id: ON_THE_BALCONY, type: 'controller', ownerId: OWNER, spaceId: BALCONY, createdAt: new Date('2026-01-01T12:00:00.000Z') },
  ]);

  await db.memberships.create([
    { id: 'membership-manager', spaceId: ROOM, userId: MANAGER, role: 'can_manage' },
    { id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_log' },
  ]);
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  devices = build();
  await world();
});

describe('the devices a caller is shown', () => {
  it.each([
    ['their owner', OWNER, [ON_THE_BALCONY, IN_THE_TENT]],
    ['somebody who may manage the room the tent stands in', MANAGER, [IN_THE_TENT]],
    ['somebody who may log in the tent itself', MEMBER, [IN_THE_TENT]],
    ['a stranger', STRANGER, []],
  ])('shows %s %s', async (_who, userId, expected) => {
    const listed = (await devices.list(session(userId), {})).items.map(device => device.id);

    expect(listed.sort()).toEqual([...expected].sort());
  });

  /**
   * An administrator is a person too, and this is the list their own screens are
   * drawn from. The fleet is read through the admin routes instead, and one
   * device by id still goes through `access()`, which is admin-wide on purpose.
   */
  it('shows an administrator their own devices and none of the install´s', async () => {
    await db.spaces.create({ id: 'space-theirs', ownerId: STRANGER, kind: 'tent', name: 'Theirs', roomId: null });
    await db.devices.create({
      id: 'device-theirs',
      type: 'controller',
      ownerId: STRANGER,
      spaceId: 'space-theirs',
      createdAt: new Date('2026-01-04T12:00:00.000Z'),
    });

    const listed = (await devices.list({ userId: OWNER, isAdmin: true, isDemo: false, shareToken: null }, {})).items.map(device => device.id);

    expect(listed).not.toContain('device-theirs');
    expect(listed.sort()).toEqual([IN_THE_TENT, ON_THE_BALCONY].sort());
  });

  it('shows a demo session the demo devices and no others', async () => {
    expect((await devices.list(demo, {})).items).toHaveLength(0);

    await db.devices.updateOne({ id: IN_THE_TENT }, { isDemo: true });
    expect((await devices.list(demo, {})).items.map(device => device.id)).toEqual([IN_THE_TENT]);
  });

  it('narrows to one space when it is asked to, without widening past what the caller may see', async () => {
    expect((await devices.list(session(MANAGER), {}, TENT)).items.map(device => device.id)).toEqual([IN_THE_TENT]);
    expect((await devices.list(session(MANAGER), {}, BALCONY)).items).toHaveLength(0);
  });

  it('never lets a later page reach past what the caller may see', async () => {
    // The caller has to be a member for this to be worth testing: a person who
    // only owns things is filtered by one plain condition, while a membership
    // makes the visibility an `$or` - which is the half a cursor would replace.
    await db.memberships.create({ id: 'membership-member-balcony', spaceId: BALCONY, userId: MEMBER, role: 'can_log' });
    await db.spaces.create({ id: 'space-theirs', ownerId: STRANGER, kind: 'tent', name: 'Theirs', roomId: null });
    await db.devices.create({
      id: 'device-theirs',
      type: 'controller',
      ownerId: STRANGER,
      spaceId: 'space-theirs',
      // Between the two this caller may see, so a page that continued by the
      // cursor alone would hand this one out as the second page.
      createdAt: new Date('2026-01-02T12:00:00.000Z'),
    });

    const first = await devices.list(session(MEMBER), { limit: 1 });
    const second = await devices.list(session(MEMBER), { limit: 1, cursor: first.nextCursor ?? '' });

    expect(first.items.map(device => device.id)).toEqual([IN_THE_TENT]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map(device => device.id)).toEqual([ON_THE_BALCONY]);
  });
});
