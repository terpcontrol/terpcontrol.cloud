import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MyGrowsService } from '@modules/v1/home/my-grows.service';
import { demo, session } from './support/callers';
import { accessOn, growsOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

/**
 * "My grows": every grow an account can see, as one card each.
 *
 * What is asserted is the order - running first, then finished by the day they
 * ended - and that a cursor continues it across the two; which grows are on it
 * (the account's own, one in a tent it was let into marked with whose it is,
 * nobody else's); and what each card says that no other list carries: where
 * the grow stands or last stood by name, the strains with their counts, the
 * harvest, and the picture - a lit camera still taken while the grow stood in
 * front of it, else the newest diary photo.
 *
 * The world: the owner's fridge with a camera and the grow running in it, a
 * finished grow that stood in the same fridge before it, a finished grow that
 * stood nowhere, a running cutting run with no place; and a friend's tent the
 * owner is a member of, with the friend's grow in it.
 */

const OWNER = 'user-owner';
const FRIEND = 'user-friend';
const STRANGER = 'user-stranger';

const FRIDGE = 'space-fridge';
const FRIEND_TENT = 'space-friend-tent';
const CAMERA = 'camera-fridge';

const RUNNING = 'grow-running';
const CUTTINGS = 'grow-cuttings';
const SPRING = 'grow-spring';
const WINDOWSILL = 'grow-windowsill';
const FRIENDS = 'grow-friends';
const STRANGERS = 'grow-strangers';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T10:00:00.000Z`);

const db = useV1TestDatabase();
let myGrows: MyGrowsService;

const build = (): MyGrowsService => {
  return new MyGrowsService(db.grows, db.plants, db.spaces, db.cameras, db.entries, db.media, db.users, growsOn(db, accessOn(db)));
};

const grow = (over: Partial<GrowDocument> & Pick<GrowDocument, 'id' | 'startedAt'>) => ({
  ownerId: OWNER,
  name: over.id,
  type: 'photoperiod',
  phases: [
    {
      id: `${over.id}-veg`,
      stage: 'vegetative',
      preset: null,
      startedAt: over.startedAt,
      source: 'human',
      plantIds: null,
      deviceId: null,
      targets: null,
      setBy: OWNER,
    },
  ],
  placements: [{ id: `${over.id}-placement`, spaceId: null, startedAt: over.startedAt, endedAt: null, plantIds: null }],
  slug: over.id,
  endedAt: null,
  ...over,
});

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: FRIEND, email: 'friend@test.invalid', handle: 'lena', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'stranger', passwordHash: 'x' },
  ]);
  await db.spaces.create([
    { id: FRIDGE, ownerId: OWNER, kind: 'fridge', name: 'Kühlschrank 1', roomId: null },
    { id: FRIEND_TENT, ownerId: FRIEND, kind: 'tent', name: 'Lenas Zelt', roomId: null },
  ]);
  await db.memberships.create({ id: 'membership-owner', spaceId: FRIEND_TENT, userId: OWNER, role: 'can_log' });
  await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', deviceId: null, spaceId: FRIDGE, name: 'Cam 1' });

  await db.grows.create([
    grow({
      id: SPRING,
      name: 'Frühling',
      startedAt: day('2026-02-01'),
      endedAt: day('2026-06-01'),
      placements: [{ id: 'spring-placement', spaceId: FRIDGE, startedAt: day('2026-02-01'), endedAt: null, plantIds: null }],
    }),
    grow({
      id: WINDOWSILL,
      name: 'Fensterbank',
      startedAt: day('2026-03-15'),
      endedAt: day('2026-05-10'),
    }),
    grow({
      id: RUNNING,
      name: 'Herbst',
      startedAt: day('2026-09-01'),
      placements: [{ id: 'running-placement', spaceId: FRIDGE, startedAt: day('2026-09-01'), endedAt: null, plantIds: null }],
    }),
    grow({ id: CUTTINGS, name: 'Stecklinge', startedAt: day('2026-09-20') }),
    grow({
      id: FRIENDS,
      ownerId: FRIEND,
      name: 'Lenas Grow',
      startedAt: day('2026-08-15'),
      placements: [{ id: 'friends-placement', spaceId: FRIEND_TENT, startedAt: day('2026-08-15'), endedAt: null, plantIds: null }],
    }),
    grow({ id: STRANGERS, ownerId: STRANGER, name: 'Fremd', startedAt: day('2026-09-10') }),
  ]);

  await db.plants.create([
    {
      id: 'spring-1',
      growId: SPRING,
      strain: 'Gelato',
      label: 'Gelato 1',
      status: 'harvested',
      createdAt: day('2026-02-01'),
      harvest: { harvestedAt: day('2026-06-01'), wetWeightG: 900, dryWeightG: 200 },
    },
    {
      id: 'spring-2',
      growId: SPRING,
      strain: 'Gelato',
      label: 'Gelato 2',
      status: 'harvested',
      createdAt: day('2026-02-01'),
      harvest: { harvestedAt: day('2026-06-01'), wetWeightG: 800, dryWeightG: 180 },
    },
    {
      id: 'spring-3',
      growId: SPRING,
      strain: 'Amnesia Haze',
      label: 'Amnesia Haze 1',
      status: 'harvested',
      createdAt: new Date(day('2026-02-01').getTime() + 1),
      harvest: { harvestedAt: day('2026-06-01'), wetWeightG: null, dryWeightG: 6 },
    },
    { id: 'running-1', growId: RUNNING, strain: 'Zkittlez', label: 'Zkittlez 1', status: 'active', createdAt: day('2026-09-01') },
  ]);
};

beforeEach(async () => {
  await db.reset();
  myGrows = build();
  await world();
});

describe('which grows, and in what order', () => {
  it('puts the running grows first, newest first, then the finished ones by the day they ended', async () => {
    const page = await myGrows.list(session(OWNER), {}, NOW);

    expect(page.items.map(card => card.growId)).toEqual([CUTTINGS, RUNNING, FRIENDS, SPRING, WINDOWSILL]);
    expect(page.nextCursor).toBeNull();
  });

  it('holds the grow somebody runs in a tent the account was let into, saying whose it is, and nobody else´s', async () => {
    const page = await myGrows.list(session(OWNER), {}, NOW);
    const friends = page.items.find(card => card.growId === FRIENDS)!;

    expect(page.items.some(card => card.growId === STRANGERS)).toBe(false);
    expect(friends.owner).toEqual({ id: FRIEND, handle: 'lena' });
    expect(friends.places).toEqual([{ spaceId: FRIEND_TENT, name: 'Lenas Zelt' }]);
    expect(page.items.filter(card => card.owner === null).map(card => card.growId)).toEqual([CUTTINGS, RUNNING, SPRING, WINDOWSILL]);
  });

  it('continues across the two halves from where a page stopped, skipping and repeating nothing', async () => {
    const first = await myGrows.list(session(OWNER), { limit: 2 }, NOW);
    const second = await myGrows.list(session(OWNER), { limit: 2, cursor: first.nextCursor! }, NOW);
    const third = await myGrows.list(session(OWNER), { limit: 2, cursor: second.nextCursor! }, NOW);

    expect([first, second, third].map(page => page.items.map(card => card.growId))).toEqual([[CUTTINGS, RUNNING], [FRIENDS, SPRING], [WINDOWSILL]]);
    expect(third.nextCursor).toBeNull();
  });

  it('keeps its place when the grow a cursor names ends before the next page is read', async () => {
    const first = await myGrows.list(session(OWNER), { limit: 1 }, NOW);
    await db.grows.updateOne({ id: CUTTINGS }, { $set: { endedAt: day('2026-09-30') } });
    const rest = await myGrows.list(session(OWNER), { cursor: first.nextCursor! }, NOW);

    expect(rest.items.map(card => card.growId)).toEqual([RUNNING, FRIENDS, CUTTINGS, SPRING, WINDOWSILL]);
  });
});

describe('a card', () => {
  it('names where a grow stands, or stood last, and says so of a grow that stood nowhere', async () => {
    const page = await myGrows.list(session(OWNER), {}, NOW);
    const of = (growId: string) => page.items.find(card => card.growId === growId)!;

    expect(of(RUNNING).places).toEqual([{ spaceId: FRIDGE, name: 'Kühlschrank 1' }]);
    expect(of(SPRING).places).toEqual([{ spaceId: FRIDGE, name: 'Kühlschrank 1' }]);
    expect(of(CUTTINGS).places).toEqual([{ spaceId: null, name: null }]);

    // Moved out of the fridge and closed there: the closed placement still names it.
    await db.grows.updateOne({ id: SPRING }, { $set: { 'placements.0.endedAt': day('2026-06-01') } });
    const again = await myGrows.list(session(OWNER), {}, NOW);
    expect(again.items.find(card => card.growId === SPRING)!.places).toEqual([{ spaceId: FRIDGE, name: 'Kühlschrank 1' }]);
  });

  it('counts the strains in the order they were sown, adds up the harvest and states how long a finished grow ran', async () => {
    const page = await myGrows.list(session(OWNER), {}, NOW);
    const spring = page.items.find(card => card.growId === SPRING)!;

    expect(spring.strains).toEqual([
      { strain: 'Gelato', count: 2 },
      { strain: 'Amnesia Haze', count: 1 },
    ]);
    expect(spring.plantCount).toBe(3);
    expect(spring.harvest).toEqual({ harvestedAt: day('2026-06-01').toISOString(), wetWeightG: 1700, dryWeightG: 386 });
    expect(spring.endedAt).toBe(day('2026-06-01').toISOString());
    expect(spring.dayNumber).toBe(121);
    expect(page.items.find(card => card.growId === RUNNING)!.harvest).toBeNull();
  });

  it('is drawn over the newest lit still taken while the grow stood in front of the camera, else its newest diary photo', async () => {
    await db.media.create([
      // The spring grow's last lit picture, and a dark one after it.
      { id: 'still-spring', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: day('2026-05-30'), lit: true },
      { id: 'still-spring-dark', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: day('2026-05-31'), lit: false },
      // Between the two grows: the fridge stood empty, and it is neither one's picture.
      { id: 'still-between', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: day('2026-07-15'), lit: true },
      { id: 'still-running', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: day('2026-09-30'), lit: null },
    ]);
    await db.entries.create([
      {
        id: 'photo-old',
        kind: 'photo',
        source: 'human',
        authorId: OWNER,
        growId: WINDOWSILL,
        occurredAt: day('2026-04-01'),
        values: { kind: 'photo' },
        mediaIds: ['photo-april'],
      },
      {
        id: 'photo-new',
        kind: 'note',
        source: 'human',
        authorId: OWNER,
        growId: WINDOWSILL,
        occurredAt: day('2026-05-01'),
        values: { kind: 'note' },
        mediaIds: ['photo-may', 'photo-may-2'],
      },
      {
        id: 'photo-spring',
        kind: 'photo',
        source: 'human',
        authorId: OWNER,
        growId: SPRING,
        occurredAt: day('2026-05-31'),
        values: { kind: 'photo' },
        mediaIds: ['photo-spring'],
      },
    ]);

    const page = await myGrows.list(session(OWNER), {}, NOW);
    const cover = (growId: string) => page.items.find(card => card.growId === growId)!.coverMediaId;

    expect(cover(SPRING)).toBe('still-spring');
    expect(cover(RUNNING)).toBe('still-running');
    expect(cover(WINDOWSILL)).toBe('photo-may');
    expect(cover(CUTTINGS)).toBeNull();
  });

  it('gives no camera picture where the camera never saw the tent lit, and the grow´s own cover wins over both', async () => {
    await db.media.create({
      id: 'still-dark',
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      cameraId: CAMERA,
      capturedAt: day('2026-09-30'),
      lit: false,
    });
    await db.grows.updateOne({ id: SPRING }, { $set: { coverMediaId: 'chosen-cover' } });

    const page = await myGrows.list(session(OWNER), {}, NOW);

    expect(page.items.find(card => card.growId === RUNNING)!.coverMediaId).toBeNull();
    expect(page.items.find(card => card.growId === SPRING)!.coverMediaId).toBe('chosen-cover');
  });

  it('hides the counts and weights from the demo tour the way the owner´s privacy says', async () => {
    await db.grows.updateOne({ id: SPRING }, { $set: { isDemo: true } });
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: true, hideCounts: true } } });

    const page = await myGrows.list(demo(null), {}, NOW);
    const spring = page.items.find(card => card.growId === SPRING)!;

    expect(page.items.map(card => card.growId)).toEqual([SPRING]);
    expect(spring.owner).toBeNull();
    expect(spring.plantCount).toBeNull();
    expect(spring.strains).toEqual([
      { strain: 'Gelato', count: null },
      { strain: 'Amnesia Haze', count: null },
    ]);
    expect(spring.harvest).toEqual({ harvestedAt: day('2026-06-01').toISOString(), wetWeightG: null, dryWeightG: null });
  });
});
