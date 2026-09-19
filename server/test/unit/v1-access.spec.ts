import { AccessService, needToEditEntry } from '@common/v1/access.service';
import { AccessContext, Need, SubjectRef } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The access matrix. Everything else in `/v1` is a screen answering wrongly when
 * it is broken; this is the one place where a mistake hands somebody else's grow
 * to a stranger - so every need is asked of every kind of subject, for every kind
 * of caller, rather than of the cases somebody thought of.
 *
 * The world is one tent inside one room, with a grow standing in it, a device, a
 * camera, an entry, a photo of the grow and a still off the camera. The two
 * members hold their membership in different places on purpose: one on the room,
 * which has to widen to the tent inside it, and one on the tent itself.
 */

const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const LOGGER = 'user-logger';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const SPACE = 'space-1';
const GROW = 'grow-1';
const PLANT = 'plant-1';
const DEVICE = 'device-1';
const CAMERA = 'camera-1';
const ENTRY = 'entry-1';
const PHOTO = 'media-photo';
const STILL = 'media-still';

const GROW_LINK = 'token-grow';
const GROW_LINK_WITH_CAMERAS = 'token-grow-cameras';
const SPACE_LINK = 'token-space';
const SPACE_LINK_WITH_CAMERAS = 'token-space-cameras';

const STARTED_AT = new Date('2026-01-05T00:00:00.000Z');

const SUBJECTS: Record<string, SubjectRef> = {
  space: { type: 'space', id: SPACE },
  grow: { type: 'grow', id: GROW },
  plant: { type: 'plant', id: PLANT },
  device: { type: 'device', id: DEVICE },
  camera: { type: 'camera', id: CAMERA },
  entry: { type: 'entry', id: ENTRY },
  photo: { type: 'media', id: PHOTO },
  still: { type: 'media', id: STILL },
};

const EVERYTHING = Object.keys(SUBJECTS);
const NOTHING: string[] = [];
const NEEDS: Need[] = ['own', 'manage', 'log', 'view'];

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const admin: AccessContext = { userId: 'user-admin', isAdmin: true, isDemo: false, shareToken: null };
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };
const anonymous: AccessContext = { userId: null, isAdmin: false, isDemo: false, shareToken: null };
const link = (token: string): AccessContext => ({ ...anonymous, shareToken: token });

let db: V1TestDatabase;
let access: AccessService;

const seed = async (world: { isPublic?: boolean; isDemo?: boolean } = {}): Promise<void> => {
  const isDemo = world.isDemo === true;

  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null, isDemo },
    { id: SPACE, ownerId: OWNER, kind: 'tent', name: 'The tent', roomId: ROOM, isDemo },
  ]);

  await db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'The grow',
    type: 'photoperiod',
    slug: 'the-grow',
    visibility: world.isPublic === true ? 'public' : 'private',
    placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
    startedAt: STARTED_AT,
    isDemo,
  });

  await db.plants.create({ id: PLANT, growId: GROW, strain: 'Amnesia', label: 'Amnesia 1' });
  await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: SPACE, isDemo });
  await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', name: 'The cam', deviceId: DEVICE, spaceId: SPACE, isDemo });

  await db.entries.create({
    id: ENTRY,
    kind: 'note',
    occurredAt: STARTED_AT,
    source: 'human',
    authorId: OWNER,
    growId: GROW,
    spaceId: SPACE,
    deviceId: DEVICE,
    values: { kind: 'note' },
  });

  await db.media.create([
    { id: PHOTO, kind: 'photo', mime: 'image/jpeg', bytes: 1, growId: GROW, uploadedBy: OWNER, capturedAt: STARTED_AT },
    { id: STILL, kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: STARTED_AT },
  ]);

  // One membership on the room, one on the tent: both have to reach everything
  // that stands in the tent.
  await db.memberships.create([
    { id: 'membership-manager', spaceId: ROOM, userId: MANAGER, role: 'can_manage' },
    { id: 'membership-logger', spaceId: SPACE, userId: LOGGER, role: 'can_log' },
  ]);

  await db.shareLinks.create([
    { id: 'link-1', token: GROW_LINK, kind: 'view', subject: { type: 'grow', id: GROW }, includeCameras: false, createdBy: OWNER },
    { id: 'link-2', token: GROW_LINK_WITH_CAMERAS, kind: 'view', subject: { type: 'grow', id: GROW }, includeCameras: true, createdBy: OWNER },
    { id: 'link-3', token: SPACE_LINK, kind: 'view', subject: { type: 'space', id: SPACE }, includeCameras: false, createdBy: OWNER },
    { id: 'link-4', token: SPACE_LINK_WITH_CAMERAS, kind: 'view', subject: { type: 'space', id: SPACE }, includeCameras: true, createdBy: OWNER },
  ]);
};

/**
 * Every need against every subject, asserted as one table: a hole then shows up
 * as the row it is, where an assertion per cell would stop at the first one and
 * hide the rest of the matrix behind it.
 */
const expectMatrix = async (ctx: AccessContext, allows: Record<Need, string[]>): Promise<void> => {
  const allowed: Partial<Record<Need, string[]>> = {};
  const expected: Partial<Record<Need, string[]>> = {};

  for (const need of NEEDS) {
    const granted: string[] = [];
    for (const [name, ref] of Object.entries(SUBJECTS)) {
      if (await access.access(ctx, ref, need)) granted.push(name);
    }

    allowed[need] = granted;
    expected[need] = EVERYTHING.filter(name => allows[need].includes(name));
  }

  expect(allowed).toEqual(expected);
};

const nothingAtAll: Record<Need, string[]> = { own: NOTHING, manage: NOTHING, log: NOTHING, view: NOTHING };

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
});

describe('a private grow, in a tent in a room', () => {
  beforeEach(() => seed());

  it('lets the owner do everything to everything', async () => {
    await expectMatrix(session(OWNER), { own: EVERYTHING, manage: EVERYTHING, log: EVERYTHING, view: EVERYTHING });
  });

  it('lets an administrator do everything to everything', async () => {
    await expectMatrix(admin, { own: EVERYTHING, manage: EVERYTHING, log: EVERYTHING, view: EVERYTHING });
  });

  it('lets a member who may manage do everything but own it, through the room', async () => {
    await expectMatrix(session(MANAGER), { own: NOTHING, manage: EVERYTHING, log: EVERYTHING, view: EVERYTHING });
  });

  it('lets a member who may log read and write, and no more', async () => {
    await expectMatrix(session(LOGGER), { own: NOTHING, manage: NOTHING, log: EVERYTHING, view: EVERYTHING });
  });

  it('tells a stranger nothing', async () => {
    await expectMatrix(session(STRANGER), nothingAtAll);
  });

  it('tells nobody at all nothing', async () => {
    await expectMatrix(anonymous, nothingAtAll);
  });

  it('tells a demo session nothing, because none of it is demo', async () => {
    await expectMatrix(demo, nothingAtAll);
  });

  it('shows a link on the grow the grow and what names it', async () => {
    await expectMatrix(link(GROW_LINK), { ...nothingAtAll, view: ['grow', 'plant', 'entry', 'photo'] });
  });

  /**
   * A still names no grow - it belongs to the camera that took it - so a link
   * onto a grow used to reach none of the pictures its own week cards point at,
   * whatever its owner had switched on. What a still is a picture of is what
   * stood in front of the camera when the shutter closed.
   *
   * The camera itself stays out of it: the link carries the pictures of the
   * grow, not the settings, the stream or the secret of the thing that took
   * them.
   */
  it('shows a link on the grow that includes cameras the pictures taken of it', async () => {
    await expectMatrix(link(GROW_LINK_WITH_CAMERAS), { ...nothingAtAll, view: ['grow', 'plant', 'entry', 'photo', 'still'] });
  });

  it('shows a link on the grow no still of the tent from before the plants stood in it', async () => {
    // The camera did not move; the grow did. A picture from before the plants
    // arrived is a picture of whatever stood there instead.
    await db.grows.updateOne(
      { id: GROW },
      { placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: new Date('2026-02-01T00:00:00.000Z'), endedAt: null, plantIds: null }] },
    );

    expect(await access.access(link(GROW_LINK_WITH_CAMERAS), SUBJECTS.still, 'view')).toBeNull();
    // The grow itself is still reached by the link it was made for.
    expect(await access.access(link(GROW_LINK_WITH_CAMERAS), SUBJECTS.grow, 'view')).not.toBeNull();
  });

  it('shows a link on the space everything standing in it, but no pictures of the camera', async () => {
    await expectMatrix(link(SPACE_LINK), { ...nothingAtAll, view: ['space', 'grow', 'plant', 'device', 'entry', 'photo'] });
  });

  it('shows a link on the space that includes cameras the camera as well', async () => {
    await expectMatrix(link(SPACE_LINK_WITH_CAMERAS), { ...nothingAtAll, view: EVERYTHING });
  });
});

describe('a public grow', () => {
  beforeEach(() => seed({ isPublic: true }));

  it('shows anybody the grow and its diary, and nothing of the tent it stands in', async () => {
    await expectMatrix(anonymous, { ...nothingAtAll, view: ['grow', 'plant', 'entry', 'photo'] });
  });

  it('shows a stranger with an account exactly the same', async () => {
    await expectMatrix(session(STRANGER), { ...nothingAtAll, view: ['grow', 'plant', 'entry', 'photo'] });
  });

  it('lets a demo session read a public page like anybody else', async () => {
    await expectMatrix(demo, { ...nothingAtAll, view: ['grow', 'plant', 'entry', 'photo'] });
  });

  it('clamps a public read to the life of the grow', async () => {
    const grant = await access.access(anonymous, SUBJECTS.grow, 'view');

    expect(grant?.range.startsAt).toEqual(STARTED_AT);
    expect(grant?.range.endsAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('ends the window where the grow ended', async () => {
    const endedAt = new Date('2026-04-01T00:00:00.000Z');
    await db.grows.updateOne({ id: GROW }, { endedAt });

    const grant = await access.access(anonymous, SUBJECTS.grow, 'view');
    expect(grant?.range.endsAt).toEqual(endedAt);
  });
});

describe('the demo tour', () => {
  beforeEach(() => seed({ isDemo: true }));

  it('reads every demo object and writes none of them', async () => {
    await expectMatrix(demo, { own: NOTHING, manage: NOTHING, log: NOTHING, view: EVERYTHING });
  });

  it('is nobody, so it is still not the owner of what it reads', async () => {
    const grant = await access.access(demo, SUBJECTS.grow, 'view');

    expect(grant?.grantee).toBe('demo');
    expect(grant?.redacted).toBe(true);
  });

  it("does not make a demo object everybody's", async () => {
    await expectMatrix(session(STRANGER), nothingAtAll);
  });
});

describe('what rides back with a yes', () => {
  beforeEach(() => seed({ isPublic: true }));

  it.each([
    ['the owner', session(OWNER), false],
    ['a member', session(LOGGER), false],
    ['a stranger reading the public page', anonymous, true],
  ])('strips the weights for everybody but the owner and the members: %s', async (_who, ctx, redacted) => {
    const grant = await access.access(ctx, SUBJECTS.grow, 'view');

    expect(grant?.redacted).toBe(redacted);
    expect(grant?.privacyOwnerId).toBe(OWNER);
  });

  it('says a link without cameras carries no pictures, so a read model does not go looking', async () => {
    const grant = await access.access(link(SPACE_LINK), SUBJECTS.space, 'view');

    expect(grant?.grantee).toBe('share');
    expect(grant?.includeCameras).toBe(false);
  });

  it('clamps a read through a link to the range of the link', async () => {
    const startsAt = new Date('2026-02-01T00:00:00.000Z');
    const endsAt = new Date('2026-03-01T00:00:00.000Z');
    await db.shareLinks.updateOne({ token: SPACE_LINK }, { range: { startsAt, endsAt } });

    const grant = await access.access(link(SPACE_LINK), SUBJECTS.space, 'view');
    expect(grant?.range).toEqual({ startsAt, endsAt });
  });

  it('leaves the window open for whoever owns the thing', async () => {
    const grant = await access.access(session(OWNER), SUBJECTS.grow, 'view');

    expect(grant?.range).toEqual({ startsAt: null, endsAt: null });
  });
});

describe('a link that is no longer one', () => {
  beforeEach(() => seed());

  it('is refused once it has been revoked', async () => {
    await db.shareLinks.updateOne({ token: GROW_LINK }, { revokedAt: new Date() });

    expect(await access.access(link(GROW_LINK), SUBJECTS.grow, 'view')).toBeNull();
  });

  it('is refused once it has expired', async () => {
    await db.shareLinks.updateOne({ token: GROW_LINK }, { expiresAt: new Date(Date.now() - 1000) });

    expect(await access.access(link(GROW_LINK), SUBJECTS.grow, 'view')).toBeNull();
  });

  it('is nothing at all when the token names no link', async () => {
    expect(await access.access(link('made-up'), SUBJECTS.grow, 'view')).toBeNull();
  });
});

describe('a grow that has moved on', () => {
  beforeEach(async () => {
    await seed();
    await db.grows.updateOne(
      { id: GROW },
      { placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: STARTED_AT, endedAt: new Date(), plantIds: null }] },
    );
  });

  it('is still readable by the members of the tent it stood in', async () => {
    expect(await access.access(session(LOGGER), SUBJECTS.grow, 'view')).not.toBeNull();
  });

  it('is no longer written to by them', async () => {
    expect(await access.access(session(LOGGER), SUBJECTS.grow, 'log')).toBeNull();
    expect(await access.access(session(MANAGER), SUBJECTS.grow, 'manage')).toBeNull();
  });

  it("stays its owner's, wherever it stands", async () => {
    expect(await access.access(session(OWNER), SUBJECTS.grow, 'own')).not.toBeNull();
  });
});

describe('a device nobody has claimed', () => {
  beforeEach(async () => {
    await seed();
    await db.devices.updateOne({ id: DEVICE }, { ownerId: null, spaceId: null });
  });

  it('belongs to nobody but an administrator', async () => {
    expect(await access.access(session(OWNER), SUBJECTS.device, 'view')).toBeNull();
    expect(await access.access(anonymous, SUBJECTS.device, 'view')).toBeNull();
    expect(await access.access(admin, SUBJECTS.device, 'own')).not.toBeNull();
  });
});

describe('a refusal', () => {
  beforeEach(() => seed());

  const refusal = async (ctx: AccessContext, ref: SubjectRef, need: Need): Promise<ProblemException> => {
    try {
      await access.require(ctx, ref, need);
    } catch (error) {
      return error as ProblemException;
    }
    throw new Error('The request was allowed.');
  };

  it('says a thing is not there when the caller may not even look at it', async () => {
    const error = await refusal(session(STRANGER), SUBJECTS.grow, 'view');

    expect(error.problem.status).toBe(404);
    expect(error.problem.code).toBe('grow_not_found');
  });

  it('says the same about a thing that really is not there', async () => {
    const error = await refusal(session(OWNER), { type: 'grow', id: 'no-such-grow' }, 'view');

    expect(error.problem.status).toBe(404);
  });

  it('admits the thing exists to somebody who may read it but not do it', async () => {
    const error = await refusal(session(LOGGER), SUBJECTS.device, 'manage');

    expect(error.problem.status).toBe(403);
    expect(error.problem.code).toBe('insufficient_access');
  });
});

describe('editing an entry', () => {
  it('is logging when it is your own', () => {
    expect(needToEditEntry(session(OWNER), OWNER)).toBe('log');
  });

  it("is managing when it is somebody else's", () => {
    expect(needToEditEntry(session(LOGGER), OWNER)).toBe('manage');
  });

  it('is managing for a demo session, which authors nothing', () => {
    expect(needToEditEntry(demo, demo.userId)).toBe('manage');
  });
});
