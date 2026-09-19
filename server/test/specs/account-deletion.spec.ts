import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { anonymous, context, createAccount, demoSession, login, loginAsAdmin, Session, unique } from '../support/api';
import { claimCodeOf, provisionDevice } from '../support/device';
import { beginDeletionOf, diaryEntriesOf, joinSpace, remindSpace, rowsIn, seedRow, storeCameraStill, storedImageExists } from '../support/fixtures';

/**
 * Deleting an account, and everything the account is.
 *
 * Almost every assertion here is about absence, which is the whole point: a
 * deletion that leaves rows behind looks exactly like one that worked, because
 * nothing lists a row whose owner is gone. So the collections without routes are
 * read from the database directly, and the two that would look right either way
 * - the follow somebody else made, and the bytes behind a picture - are read the
 * only way that can tell.
 *
 * The device is the other half. It is not deleted, it is handed back: the
 * hardware is still out there, and somebody has to be able to claim it again.
 */

const SERVER_ROOT = join(__dirname, '..', '..');

/** A 2x2 PNG, small enough to be stored a dozen times without mattering. */
const A_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AzbAxIAdjEoRlgIAaFcDAx2LUNMAAAAASUVORK5CYII=',
  'base64',
);

interface Household {
  owner: Session;
  deviceId: string;
  spaceId: string;
  growId: string;
  slug: string;
  token: string;
  cameraId: string;
  cameraDid: string;
  stillId: string;
  reminderId: string;
  chartViewId: string;
  schemeId: string;
  planId: string;
  ruleId: string;
}

let admin: Session;
let stranger: Session;

/**
 * An account with one of everything the cascade has to reach: a tent with a
 * controller in it, a public grow with plants, a link out of that grow, a
 * follower, a webcam with a picture in the store, and a row in each of the
 * collections that have no routes yet.
 */
const aHousehold = async (): Promise<Household> => {
  const owner = await createAccount('deleted');

  const device = await provisionDevice(owner, 'controller');
  const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;

  const grow = (
    await owner.client
      .post('/v1/grows')
      .send({ name: 'The last run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 2 }], spaceId })
      .expect(201)
  ).body;
  await owner.client.patch(`/v1/grows/${grow.id}`).send({ visibility: 'public' }).expect(200);
  await owner.client
    .post('/v1/entries')
    .send({ kind: 'note', growId: grow.id, text: 'Fed them.', values: { kind: 'note' } })
    .expect(201);

  const link = (
    await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'grow', id: grow.id } })
      .expect(201)
  ).body;
  await stranger.client.put(`/v1/follows/${grow.id}`).expect(200);

  // A Terp Cam the controller answers for, with a still in the picture store.
  // Seeded rather than paired, because the pairing id is what a later controller
  // would revive the row by, and the spec has to name it.
  const cameraId = randomUUID();
  const cameraDid = unique('DID').toUpperCase();
  await seedRow('cameras', {
    id: cameraId,
    createdAt: new Date(),
    ownerId: owner.userId,
    kind: 'terpcam_controller',
    deviceId: device.deviceId,
    spaceId,
    name: 'The tent cam',
    plantIds: [],
    did: cameraDid,
    stillIntervalSeconds: 30,
    nightOff: false,
    maintenanceOff: false,
    logErrors: false,
    tunnel: false,
    entitlement: { validUntil: null, grant: null },
    isDemo: false,
    removedAt: null,
    state: { lastStillAt: null, lastError: null, firmwareVersion: null },
  });
  const stillId = await storeCameraStill(cameraId, A_PICTURE, new Date());

  const reminderId = await remindSpace(spaceId, owner.userId);

  const chartViewId = randomUUID();
  await seedRow('chartViews', {
    id: chartViewId,
    createdAt: new Date(),
    ownerId: owner.userId,
    name: 'Last week',
    definition: { deviceIds: [device.deviceId], growId: grow.id, metrics: [], outputs: [], range: null, forSeconds: null, intervalSeconds: 300 },
  });

  const schemeId = randomUUID();
  await seedRow('schemes', { id: schemeId, createdAt: new Date(), ownerId: owner.userId, name: 'House mix', origin: {}, grid: [] });
  await seedRow('planTemplates', { id: randomUUID(), createdAt: new Date(), ownerId: owner.userId, name: 'Nights off', isPublic: true, steps: [] });
  await seedRow('pushSubscriptions', {
    id: randomUUID(),
    createdAt: new Date(),
    userId: owner.userId,
    endpoint: `https://push.test.invalid/${randomUUID()}`,
    keys: { p256dh: 'k', auth: 'a' },
    userAgent: null,
  });
  await seedRow('notificationLog', {
    id: randomUUID(),
    createdAt: new Date(),
    userId: owner.userId,
    channel: 'email',
    category: 'alarm',
    subject: { type: 'alert', id: randomUUID() },
    externalMessageId: null,
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  // What the previous owner decided about the hardware. Neither has a route yet,
  // and both are what the next claimant must not inherit.
  const planId = randomUUID();
  const ruleId = randomUUID();
  await seedRow('plans', { id: planId, createdAt: new Date(), deviceId: device.deviceId, templateId: null, steps: [] });
  await seedRow('alarmRules', { id: ruleId, createdAt: new Date(), deviceId: device.deviceId, origin: 'human', metric: 'temperature' });
  await seedRow('alerts', {
    id: randomUUID(),
    createdAt: new Date(),
    ruleId,
    deviceId: device.deviceId,
    kind: 'threshold',
    severity: 'warning',
    startedAt: new Date(),
    resolvedAt: null,
  });

  return {
    owner,
    deviceId: device.deviceId,
    spaceId,
    growId: grow.id,
    slug: grow.slug,
    token: link.token,
    cameraId,
    cameraDid,
    stillId,
    reminderId,
    chartViewId,
    schemeId,
    planId,
    ruleId,
  };
};

beforeAll(async () => {
  admin = await loginAsAdmin();
  stranger = await createAccount('deletion-stranger');
});

describe('deleting an account', () => {
  jest.setTimeout(60_000);

  let home: Household;

  beforeAll(async () => {
    home = await aHousehold();

    // It is still all there before the route is called: otherwise every
    // assertion below would pass against a household that was never built.
    await anonymous().get(`/v1/public/grows/${home.slug}`).expect(200);
    await anonymous().get(`/v1/shared/${home.token}`).expect(200);

    await admin.client.delete(`/v1/admin/users/${home.owner.userId}`).expect(204);
  });

  it('stops serving the diary it published, and every link onto it', async () => {
    await anonymous().get(`/v1/public/grows/${home.slug}`).expect(404);
    await anonymous().get(`/v1/shared/${home.token}`).expect(404);
  });

  it('leaves no account behind, and says so the second time', async () => {
    await admin.client.get(`/v1/admin/users/${home.owner.userId}`).expect(404);
    await admin.client.delete(`/v1/admin/users/${home.owner.userId}`).expect(404);
  });

  it('signs out what the account was signed in with', async () => {
    await anonymous().post('/v1/sessions/refresh').send({ refreshToken: home.owner.refreshToken }).expect(401);
  });

  it('takes somebody else´s follow of the grow with it', async () => {
    const followed = (await stranger.client.get('/v1/follows').expect(200)).body;
    expect(followed.items.some((row: { growId: string }) => row.growId === home.growId)).toBe(false);
    // The list drops what it cannot read, so the row itself has to be asked for.
    expect(await rowsIn('follows', { growId: home.growId })).toEqual([]);
  });

  it('leaves nothing of what the account owned', async () => {
    expect(await rowsIn('spaces', { id: home.spaceId })).toEqual([]);
    expect(await rowsIn('grows', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('plants', { growId: home.growId })).toEqual([]);
    expect(await rowsIn('entries', { growId: home.growId })).toEqual([]);
    expect(await rowsIn('entries', { spaceId: home.spaceId })).toEqual([]);
    expect(await rowsIn('shareLinks', { createdBy: home.owner.userId })).toEqual([]);
    expect(await rowsIn('reminders', { id: home.reminderId })).toEqual([]);
    expect(await rowsIn('memberships', { userId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('chartViews', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('schemes', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('planTemplates', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('pushSubscriptions', { userId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('notificationLog', { userId: home.owner.userId })).toEqual([]);
  });

  /**
   * The camera row is deleted rather than tombstoned, and the pairing id is the
   * reason: a controller reporting the same webcam again finds a row by that id
   * whether or not it is dead and brings it back, owner and all.
   */
  it('deletes the camera rather than marking it removed', async () => {
    expect(await rowsIn('cameras', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('cameras', { did: home.cameraDid })).toEqual([]);
  });

  it('frees the bytes behind the pictures, not only the rows that index them', async () => {
    expect(await rowsIn('media', { cameraId: home.cameraId })).toEqual([]);
    expect(await storedImageExists(home.stillId)).toBe(false);
  });

  it('leaves nothing of the previous owner on the device', async () => {
    expect(await rowsIn('plans', { deviceId: home.deviceId })).toEqual([]);
    expect(await rowsIn('alarmRules', { id: home.ruleId })).toEqual([]);
    expect(await rowsIn('alerts', { deviceId: home.deviceId })).toEqual([]);
    // What the hardware reported is not the next owner's to read.
    expect(await diaryEntriesOf(home.deviceId)).toEqual([]);
  });

  it('hands the device back, so somebody else can claim it', async () => {
    const next = await createAccount('deletion-next');

    const claimed = (
      await next.client
        .post('/v1/devices/claims')
        .send({ code: await claimCodeOf(home.deviceId) })
        .expect(201)
    ).body;

    expect(claimed.device.ownerId).toBe(next.userId);
    // A claim always ends in a space, and the one the previous owner stood it in
    // is gone - so the claim makes one rather than finding it.
    expect(claimed.spaceCreated).toBe(true);
  });
});

describe('what belongs to somebody else', () => {
  jest.setTimeout(60_000);

  let home: Household;
  let theirGrow: string;
  let theirLine: string;
  let ourLineInTheirTent: string;
  let theirTent: string;

  beforeAll(async () => {
    home = await aHousehold();

    // Each of them is let into the other's tent, which is what makes the two
    // cases below possible at all.
    await joinSpace(home.spaceId, stranger.userId, 'can_manage');
    const theirDevice = await provisionDevice(stranger, 'fridge');
    theirTent = (await stranger.client.get(`/v1/devices/${theirDevice.deviceId}`).expect(200)).body.spaceId;
    await joinSpace(theirTent, home.owner.userId, 'can_log');

    theirLine = (
      await stranger.client
        .post('/v1/entries')
        .send({ kind: 'note', spaceId: home.spaceId, text: 'Looked in on it.', values: { kind: 'note' } })
        .expect(201)
    ).body.id;

    ourLineInTheirTent = (
      await home.owner.client
        .post('/v1/entries')
        .send({ kind: 'note', spaceId: theirTent, text: 'Watered while they were away.', values: { kind: 'note' } })
        .expect(201)
    ).body.id;

    theirGrow = (
      await stranger.client
        .post('/v1/grows')
        .send({ name: 'Standing in a borrowed tent', type: 'autoflower', plants: [], spaceId: home.spaceId })
        .expect(201)
    ).body.id;

    await admin.client.delete(`/v1/admin/users/${home.owner.userId}`).expect(204);
  });

  it('takes a line somebody else wrote on the deleted account´s timeline', async () => {
    expect(await rowsIn('entries', { id: theirLine })).toEqual([]);
  });

  it('keeps a line the deleted account wrote on somebody else´s, without its author', async () => {
    const [kept] = await rowsIn('entries', { id: ourLineInTheirTent });

    expect(kept).toBeDefined();
    expect(kept.authorId).toBeNull();
    expect(kept.text).toBe('Watered while they were away.');
    await stranger.client.get(`/v1/entries/${ourLineInTheirTent}`).expect(200);
  });

  it('ends somebody else´s grow´s stay in the tent rather than deleting the grow', async () => {
    const grow = (await stranger.client.get(`/v1/grows/${theirGrow}`).expect(200)).body;

    const placement = grow.placements.find((row: { spaceId: string }) => row.spaceId === home.spaceId);
    expect(placement).toBeDefined();
    expect(placement.endedAt).toEqual(expect.any(String));
  });

  it('takes the members out of the space it deletes', async () => {
    expect(await rowsIn('memberships', { spaceId: home.spaceId })).toEqual([]);
  });
});

describe('deleting yourself', () => {
  jest.setTimeout(60_000);

  it('deletes the caller´s own account and ends the session it asked with', async () => {
    const home = await aHousehold();

    await home.owner.client.delete('/v1/me').expect(204);

    await anonymous().post('/v1/sessions/refresh').send({ refreshToken: home.owner.refreshToken }).expect(401);
    await anonymous().get(`/v1/public/grows/${home.slug}`).expect(404);
    expect(await rowsIn('users', { id: home.owner.userId })).toEqual([]);
    expect(await rowsIn('spaces', { id: home.spaceId })).toEqual([]);
  });

  it('refuses a session that is not an account at all', async () => {
    await (await demoSession()).client.delete('/v1/me').expect(403);
  });

  /**
   * The configured account is looked up by its address and written back on every
   * start, so deleting it would either bring it back mid-run or re-create it
   * under a new id with everything this one owned stranded behind the old one.
   */
  it('keeps the account this install is configured with, from either route', async () => {
    const refused = await admin.client.delete(`/v1/admin/users/${admin.userId}`).expect(409);
    expect(refused.body.code).toBe('admin_account_kept');

    await admin.client.delete('/v1/me').expect(409);
    await loginAsAdmin();
  });

  it('refuses to sign in an account whose deletion has begun', async () => {
    const leaving = await createAccount('deletion-halfway');
    await beginDeletionOf(leaving.userId);

    // The same nothing an unknown address gets: a marked account must not be
    // able to open a fresh session and write into the half that is left.
    await anonymous().post('/v1/sessions').send({ email: leaving.username, password: leaving.password }).expect(401);

    await admin.client.delete(`/v1/admin/users/${leaving.userId}`).expect(204);
  });
});

/**
 * What the account was holding when it was deleted.
 *
 * A user token lives five minutes past the request that was answered with it,
 * so without a lookup the cascade would be undone by the account it had just
 * taken apart: a new public grow, a fresh picture, and the very device that was
 * handed back claimed again by the id that no longer exists. Every route behind
 * the guards resolves its caller against the session row, and the cascade ends
 * every session before anything else, so there is nothing left to ask with.
 */
describe('the token the deleted account was holding', () => {
  jest.setTimeout(60_000);

  let home: Household;
  let published: string;

  beforeAll(async () => {
    home = await aHousehold();

    published = (await stranger.client.post('/v1/grows').send({ name: 'Published', type: 'photoperiod', plants: [] }).expect(201)).body.id;
    await stranger.client.patch(`/v1/grows/${published}`).send({ visibility: 'public' }).expect(200);

    // Good right up to the deletion, so what follows is about the deletion
    // rather than about a token that never worked.
    await home.owner.client.get('/v1/me').expect(200);

    await admin.client.delete(`/v1/admin/users/${home.owner.userId}`).expect(204);
  });

  it('follows nothing, uploads nothing and publishes nothing with it', async () => {
    await home.owner.client.put(`/v1/follows/${published}`).expect(401);
    await home.owner.client.post('/v1/media').field('kind', 'avatar').attach('file', A_PICTURE, 'a.png').expect(401);
    await home.owner.client.post('/v1/grows').send({ name: 'After the deletion', type: 'photoperiod', plants: [] }).expect(401);

    expect(await rowsIn('follows', { userId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('media', { uploadedBy: home.owner.userId })).toEqual([]);
    expect(await rowsIn('grows', { ownerId: home.owner.userId })).toEqual([]);
  });

  it('cannot claim back the device the cascade just handed over', async () => {
    await home.owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(home.deviceId) })
      .expect(401);

    expect((await rowsIn('devices', { id: home.deviceId }))[0].ownerId).toBeNull();
  });

  /** A stranger trying tokens must not learn that an account was ever here. */
  it('is refused in the same words as a token this server never signed', async () => {
    const deleted = await home.owner.client.get('/v1/me').expect(401);
    const nonsense = await anonymous().get('/v1/me').set('Authorization', 'Bearer not-a-token-at-all').expect(401);

    expect(deleted.body).toEqual(nonsense.body);
  });

  it('reads no accounts and deletes none, where it was an administrator', async () => {
    const password = 'Passw0rd!test';
    const username = `${unique('deletion-admin')}@test.invalid`;
    const created = (
      await admin.client
        .post('/v1/admin/users')
        .send({ email: username, handle: unique('deladmin'), password, isAdmin: true })
        .expect(201)
    ).body;

    const wasAdmin = await login(username, password);
    await wasAdmin.client.get('/v1/admin/users').expect(200);

    await admin.client.delete(`/v1/admin/users/${created.id}`).expect(204);

    await wasAdmin.client.get('/v1/admin/users').expect(401);
    await wasAdmin.client.delete(`/v1/admin/users/${stranger.userId}`).expect(401);
    expect(await rowsIn('users', { id: stranger.userId })).toHaveLength(1);
  });
});

describe('a run that was interrupted', () => {
  jest.setTimeout(120_000);

  it('is finished by calling the route again, which is the same steps over', async () => {
    const home = await aHousehold();
    await beginDeletionOf(home.owner.userId);

    await admin.client.delete(`/v1/admin/users/${home.owner.userId}`).expect(204);

    expect(await rowsIn('users', { id: home.owner.userId })).toEqual([]);
    expect(await rowsIn('spaces', { id: home.spaceId })).toEqual([]);
    expect(await rowsIn('grows', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('cameras', { ownerId: home.owner.userId })).toEqual([]);
    await anonymous().get(`/v1/public/grows/${home.slug}`).expect(404);
  });

  /**
   * And by a server starting up, which is the case the marker exists for: a run
   * that died between two of its steps has nothing but the row to be found by.
   * A second server is started for it rather than the one the specs talk to,
   * which did its own sweep long before this fixture existed.
   */
  it('is finished by the next server to start', async () => {
    const home = await aHousehold();
    await beginDeletionOf(home.owner.userId);

    const built = process.env.HARNESS_BUILT === '1';
    const script = built ? 'dist/main.js' : 'src/main.ts';
    const nodeArgs = built ? [] : ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'];

    const child = spawn('node', [...nodeArgs, script], {
      cwd: SERVER_ROOT,
      // Port 0, so this one does not want the port the running server holds -
      // which is also why the database is polled rather than a probe.
      env: { ...process.env, ...context.appEnv, PORT: '0' },
    });

    try {
      const deadline = Date.now() + 90_000;
      let left = await rowsIn('users', { id: home.owner.userId });
      while (left.length > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        left = await rowsIn('users', { id: home.owner.userId });
      }
      expect(left).toEqual([]);
    } finally {
      child.kill('SIGTERM');
    }

    expect(await rowsIn('spaces', { id: home.spaceId })).toEqual([]);
    expect(await rowsIn('grows', { ownerId: home.owner.userId })).toEqual([]);
    expect(await rowsIn('cameras', { did: home.cameraDid })).toEqual([]);
    expect(await rowsIn('plans', { deviceId: home.deviceId })).toEqual([]);

    const next = await createAccount('deletion-resumed');
    const claimed = (
      await next.client
        .post('/v1/devices/claims')
        .send({ code: await claimCodeOf(home.deviceId) })
        .expect(201)
    ).body;
    expect(claimed.device.ownerId).toBe(next.userId);
  });
});
