import { DevicesService } from '@modules/v1/device/devices.service';
import { admin, demo, session } from './support/callers';
import { accessOn, devicesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

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

const db = useV1TestDatabase();
let devices: DevicesService;

const build = (): DevicesService => devicesOn(db, accessOn(db));

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

    const listed = (await devices.list(admin(OWNER), {})).items.map(device => device.id);

    expect(listed).not.toContain('device-theirs');
    expect(listed.sort()).toEqual([IN_THE_TENT, ON_THE_BALCONY].sort());
  });

  it('shows a demo session the demo devices and no others', async () => {
    expect((await devices.list(demo(), {})).items).toHaveLength(0);

    await db.devices.updateOne({ id: IN_THE_TENT }, { isDemo: true });
    expect((await devices.list(demo(), {})).items.map(device => device.id)).toEqual([IN_THE_TENT]);
  });

  it('takes the demo along when a demo device moves to another place', async () => {
    await db.devices.updateOne({ id: IN_THE_TENT }, { isDemo: true });
    await db.spaces.updateOne({ id: TENT }, { isDemo: true });

    await devices.update(IN_THE_TENT, { spaceId: BALCONY });

    const flags = Object.fromEntries((await db.spaces.find({ id: { $in: [TENT, BALCONY] } }).lean()).map(space => [space.id, space.isDemo]));
    expect(flags).toEqual({ [TENT]: false, [BALCONY]: true });
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

/**
 * A claim that says where the device hangs. The client asks before it knows
 * what the code names, so it sends the answer as `joinSpaceId` and the server
 * decides by the type: a device without a climate of its own joins that place
 * in the one write, and no place is made to be removed again.
 */
describe('claiming a device with a place to join', () => {
  const NEW = 'device-new';
  const THEIR_TENT = 'space-theirs';
  const CODE = 'JOIN2345';

  const unclaimed = async (type: string) => {
    await db.devices.create({ id: NEW, type, ownerId: null, spaceId: null, placements: [] });
    await db.claimCodes.create({ id: 'claim-new', code: CODE, deviceId: NEW });
  };

  const refusal = (action: () => Promise<unknown>) =>
    action().then(
      () => Promise.reject(new Error('It was allowed.')),
      error => error.problem,
    );

  it.each(['fan', 'plug', 'light'])('puts a %s into the place named, and makes none', async type => {
    await unclaimed(type);
    const claimed = await devices.claim(session(OWNER), { code: CODE, joinSpaceId: TENT });

    expect(claimed).toMatchObject({ spaceCreated: false, device: { id: NEW, ownerId: OWNER, spaceId: TENT } });
    expect(await db.spaces.countDocuments({})).toBe(3);
    expect((await db.devices.findOne({ id: NEW }).lean())?.placements).toMatchObject([{ spaceId: TENT, endedAt: null }]);
  });

  it.each(['controller', 'fridge'])('gives a %s its own place all the same', async type => {
    await unclaimed(type);
    const claimed = await devices.claim(session(OWNER), { code: CODE, joinSpaceId: TENT });

    expect(claimed.spaceCreated).toBe(true);
    expect(claimed.device.spaceId).not.toBe(TENT);
    expect(await db.spaces.findOne({ id: claimed.device.spaceId }).lean()).toMatchObject({ ownerId: OWNER, roomId: null });
  });

  it('refuses a place of another account, a room and an ended place, and the code still claims afterwards', async () => {
    await unclaimed('fan');
    await db.spaces.create({ id: THEIR_TENT, ownerId: STRANGER, kind: 'tent', name: 'Theirs', roomId: null });
    await db.memberships.create({ id: 'membership-guest', spaceId: THEIR_TENT, userId: OWNER, role: 'can_manage' });
    await db.spaces.create({ id: 'space-ended', ownerId: OWNER, kind: 'tent', name: 'Ended', roomId: null, archivedAt: new Date() });

    expect(await refusal(() => devices.claim(session(OWNER), { code: CODE, joinSpaceId: THEIR_TENT }))).toMatchObject({
      status: 409,
      code: 'place_of_another_account',
    });
    expect(await refusal(() => devices.claim(session(OWNER), { code: CODE, joinSpaceId: ROOM }))).toMatchObject({
      status: 409,
      code: 'room_by_itself',
    });
    // An ended place takes nothing, whichever field names it.
    expect(await refusal(() => devices.claim(session(OWNER), { code: CODE, joinSpaceId: 'space-ended' }))).toMatchObject({ code: 'space_archived' });
    // The sentence states the fact and asks for nothing the app cannot do.
    expect(await refusal(() => devices.claim(session(OWNER), { code: CODE, spaceId: 'space-ended' }))).toMatchObject({
      status: 409,
      code: 'space_archived',
      detail: 'That place has ended, and nothing is put into an ended place.',
    });
    // A place the caller has nothing to do with is not there, as for `spaceId`.
    expect(await refusal(() => devices.claim(session(MEMBER), { code: CODE, joinSpaceId: BALCONY }))).toMatchObject({ status: 404 });
    expect(await db.devices.findOne({ id: NEW }).lean()).toMatchObject({ ownerId: null, spaceId: null });

    expect((await devices.claim(session(OWNER), { code: CODE, joinSpaceId: TENT })).device.spaceId).toBe(TENT);
  });

  /**
   * The place a claim makes is called what the claim says - the word for it in
   * the claimer's language, which only the client knows - and numbered where
   * that name is taken. Without it the server has a word of its own, never a
   * scrap of the device's id.
   */
  it('calls the place it makes what the claim says, counting on where the name is taken', async () => {
    await db.spaces.create({ id: 'space-zelt', ownerId: OWNER, kind: 'tent', name: 'Zelt', roomId: null });
    await unclaimed('controller');

    const claimed = await devices.claim(session(OWNER), { code: CODE, spaceNames: { tent: ' Zelt ', fridge: 'Kühlschrank' } });

    expect(claimed.spaceCreated).toBe(true);
    expect(await db.spaces.findOne({ id: claimed.device.spaceId }).lean()).toMatchObject({ name: 'Zelt 2', kind: 'tent' });
  });

  it.each([
    ['fridge', 'Kühlschrank', 'fridge'],
    ['fan', 'Zelt', 'other'],
  ])('calls the place a %s gets "%s": the type is known to the server alone', async (type, name, kind) => {
    await db.spaces.deleteMany({});
    await unclaimed(type);

    const claimed = await devices.claim(session(OWNER), { code: CODE, spaceNames: { tent: 'Zelt', fridge: 'Kühlschrank' } });

    expect(await db.spaces.findOne({ id: claimed.device.spaceId }).lean()).toMatchObject({ name, kind });
  });

  it.each([
    ['controller', 'Tent'],
    ['fridge', 'Fridge'],
    ['plug', 'Place'],
  ])('calls the place of a %s claimed without a name "%s"', async (type, word) => {
    await unclaimed(type);

    const claimed = await devices.claim(session(OWNER), { code: CODE });

    expect((await db.spaces.findOne({ id: claimed.device.spaceId }).lean())?.name).toBe(word);
  });

  it('leaves the name of the place a device joins alone', async () => {
    await unclaimed('fan');

    await devices.claim(session(OWNER), { code: CODE, joinSpaceId: TENT, spaceNames: { tent: 'Zelt' } });

    expect((await db.spaces.findOne({ id: TENT }).lean())?.name).toBe('Tent 1');
    expect(await db.spaces.countDocuments({})).toBe(3);
  });

  it('refuses both fields together: two statements about one place', async () => {
    await unclaimed('fan');

    expect(await refusal(() => devices.claim(session(OWNER), { code: CODE, spaceId: TENT, joinSpaceId: BALCONY }))).toMatchObject({
      status: 422,
      code: 'two_places',
    });
    expect(await db.claimCodes.countDocuments({ code: CODE })).toBe(1);
  });

  it('refuses a move into an ended place as a claim into one', async () => {
    await db.spaces.updateOne({ id: BALCONY }, { $set: { archivedAt: new Date() } });

    expect(await refusal(() => devices.update(IN_THE_TENT, { spaceId: BALCONY }))).toMatchObject({ status: 409, code: 'space_archived' });
    expect((await db.devices.findOne({ id: IN_THE_TENT }).lean())?.spaceId).toBe(TENT);
  });
});
