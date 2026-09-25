import { anonymous, createAccount, loginAsAdmin, Session } from '../support/api';
import { claimCodeOf, DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';
import { joinSpace, setRow } from '../support/fixtures';

/**
 * A camera: adding one, what the camera page edits about it, and the composer.
 *
 * A tent holds several - the Terp Cam its controller pairs, RTSP cameras pulled
 * through that controller, and standalone Terp Cams the cloud reaches itself -
 * so what tells them apart is what a create body has to say, and the settings
 * below it are the same for all of them.
 */

let owner: Session;
let tent: string;
let device: Awaited<ReturnType<typeof provisionDevice>>;

const rtsp = (over: Record<string, unknown> = {}) => ({
  kind: 'rtsp',
  spaceId: tent,
  name: 'Tapo C200',
  url: 'rtsp://viewer:hunter2@10.0.0.30:554/stream1',
  ...over,
});

const addCamera = async (body: Record<string, unknown> = rtsp()): Promise<string> =>
  (await owner.client.post('/v1/cameras').send(body).expect(201)).body.id;

beforeAll(async () => {
  owner = await createAccount('cameras-owner');
  device = await provisionDevice(owner, 'controller');
  tent = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
});

describe('adding a camera', () => {
  it('takes an RTSP camera by the address of its stream, and never answers the credentials back', async () => {
    const created = await owner.client
      .post('/v1/cameras')
      .send(rtsp({ transport: 'tcp', model: 'tapo_c200' }))
      .expect(201);

    expect(created.body).toMatchObject({ kind: 'rtsp', spaceId: tent, name: 'Tapo C200', transport: 'tcp', model: 'tapo_c200' });
    // The credentials the stream is opened with are the server's to keep, and
    // the owner is no more entitled to read them back than anybody else.
    expect(created.body.url).toBe('rtsp://10.0.0.30:554/stream1');
    // An RTSP camera has no included year of its own; it is entitled by purchase.
    expect(created.body.entitlement).toMatchObject({ validUntil: null, grant: null });
  });

  it('says a standalone Terp Cam is coming, because this install has no rendezvous to find one through', async () => {
    const refused = await owner.client
      .post('/v1/cameras')
      .send({ kind: 'terpcam_standalone', spaceId: tent, name: 'On the balcony', did: 'TERP123456' })
      .expect(400);

    expect(refused.body.code).toBe('not_yet');
    expect(refused.body.detail).toMatch(/no rendezvous/);
  });

  it('will not pull a stream through hardware that has no tunnel', async () => {
    const fridge = await provisionDevice(owner, 'fridge');

    const refused = await owner.client
      .post('/v1/cameras')
      .send(rtsp({ deviceId: fridge.deviceId, tunnel: true }))
      .expect(422);
    expect(refused.body.code).toBe('not_a_controller');
  });

  it('will not put a camera nowhere, nor into somebody else´s tent', async () => {
    const nowhere = await owner.client.post('/v1/cameras').send({ kind: 'rtsp', name: 'Nowhere', url: 'rtsp://10.0.0.31/s' }).expect(400);
    expect(nowhere.body.code).toBe('nowhere_to_put_it');

    const stranger = await createAccount('cameras-stranger');
    await stranger.client.post('/v1/cameras').send(rtsp()).expect(404);
  });
});

describe('what the camera page edits', () => {
  let camera: string;

  beforeAll(async () => {
    camera = await addCamera();
  });

  it('changes its name, what it looks at, how often it takes a picture and when it stops', async () => {
    const updated = await owner.client
      .patch(`/v1/cameras/${camera}`)
      .send({ name: 'Canopy', looksAt: 'canopy', stillIntervalSeconds: 300, nightOff: true, maintenanceOff: true })
      .expect(200);

    expect(updated.body).toMatchObject({ name: 'Canopy', looksAt: 'canopy', stillIntervalSeconds: 300, nightOff: true, maintenanceOff: true });
  });

  it('refuses an interval the pipeline could not keep', async () => {
    const refused = await owner.client.patch(`/v1/cameras/${camera}`).send({ stillIntervalSeconds: 5 }).expect(422);

    expect(refused.body.code).toBe('still_interval_too_short');
  });

  it('refuses a stream address on a camera that is not read from a stream', async () => {
    // The controller's own Terp Cam is reached by the id it reported, so a URL
    // on it would be stored where nothing reads it.
    const paired = await owner.client.post('/v1/cameras').send({ kind: 'terpcam_controller', deviceId: device.deviceId, name: 'Terp Cam' });
    expect(paired.status).toBe(201);

    const refused = await owner.client.patch(`/v1/cameras/${paired.body.id}`).send({ url: 'rtsp://10.0.0.40/s' }).expect(422);
    expect(refused.body.code).toBe('not_a_stream');

    // Its controller is the one that paired it, which is not a thing to move.
    const moved = await owner.client.patch(`/v1/cameras/${paired.body.id}`).send({ deviceId: null }).expect(422);
    expect(moved.body.code).toBe('not_a_stream');
  });

  it('moves the controller a stream is pulled through when the camera is moved', async () => {
    const moved = await owner.client.patch(`/v1/cameras/${camera}`).send({ deviceId: device.deviceId, tunnel: true }).expect(200);
    expect(moved.body).toMatchObject({ deviceId: device.deviceId, tunnel: true });

    // A tent with no controller in it is reached by the cloud itself, and the
    // stored camera has to stop naming the one it used to be pulled through.
    const away = await owner.client.patch(`/v1/cameras/${camera}`).send({ deviceId: null, tunnel: false }).expect(200);
    expect(away.body).toMatchObject({ deviceId: null, tunnel: false });
  });

  it('refuses a tunnel through hardware that has none, and a tunnel through nothing at all', async () => {
    const fridge = await provisionDevice(owner, 'fridge');

    const notAController = await owner.client.patch(`/v1/cameras/${camera}`).send({ deviceId: fridge.deviceId, tunnel: true }).expect(422);
    expect(notAController.body.code).toBe('not_a_controller');

    const nothingToTunnelThrough = await owner.client.patch(`/v1/cameras/${camera}`).send({ deviceId: null, tunnel: true }).expect(422);
    expect(nothingToTunnelThrough.body.code).toBe('tunnel_without_controller');
  });

  it('refuses a controller a stranger owns', async () => {
    const stranger = await createAccount('cameras-tunnel-stranger');
    const theirs = await provisionDevice(stranger, 'controller');

    await owner.client.patch(`/v1/cameras/${camera}`).send({ deviceId: theirs.deviceId, tunnel: true }).expect(404);
  });

  it('is hidden from everyone it does not belong to', async () => {
    const stranger = await createAccount('cameras-outsider');

    await stranger.client.get(`/v1/cameras/${camera}`).expect(404);
    await stranger.client.patch(`/v1/cameras/${camera}`).send({ name: 'Mine now' }).expect(404);
    // Reading a camera takes a session or a share link or neither, because a
    // public page has none; a caller with nothing is simply shown nothing.
    await anonymous().get(`/v1/cameras/${camera}`).expect(404);
    await anonymous().patch(`/v1/cameras/${camera}`).send({ name: 'Mine now' }).expect(401);
  });
});

/**
 * A query string carries a flag as text, and the flag was parsed with a
 * coercion that is `Boolean(value)` - so every word but the empty one meant
 * true, and the client that read the contract and sent `false` was handed the
 * tombstones it had asked to leave out.
 */
describe('asking for the cameras that are gone', () => {
  it('reads `false` as false, and refuses a word that is neither', async () => {
    const gone = await addCamera(rtsp({ name: 'Taken down' }));
    await owner.client.delete(`/v1/cameras/${gone}`).expect(204);

    const listed = async (query: string): Promise<string[]> =>
      (await owner.client.get(`/v1/cameras${query}`).expect(200)).body.items.map((one: { id: string }) => one.id);

    expect(await listed('?includeRemoved=true')).toContain(gone);
    expect(await listed('?includeRemoved=false')).not.toContain(gone);
    expect(await listed('')).not.toContain(gone);

    // And a word the parameter cannot be is a refusal rather than a silent
    // `true`, the way every other flag of a /v1 query string answers.
    const refused = await owner.client.get('/v1/cameras?includeRemoved=yes').expect(400);
    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors[0].field).toBe('includeRemoved');
    // And it says what did not fit. This is a GET with no body to be wrong.
    expect(refused.body.detail).toContain('query string');
  });
});

/**
 * The Terp Cam a controller pairs is reported over MQTT and never created by
 * hand, so this is the one part of a camera's life that starts at the hardware:
 * both halves have to agree about who the picture belongs to when the hardware
 * is sold on.
 */
describe('the camera of a controller that changes hands', () => {
  const HANDED_ON = 'TERPCAMSOLD';
  const STILL_IN_USE = 'TERPCAMKEPT';

  let first: Session;
  let next: Session;
  let stranger: Session;
  let sold: Awaited<ReturnType<typeof provisionDevice>>;
  let kept: Awaited<ReturnType<typeof provisionDevice>>;
  let theirs: Awaited<ReturnType<typeof provisionDevice>>;
  let simulators: DeviceSimulator[];

  const pairs = async (simulator: DeviceSimulator, did: string): Promise<void> => {
    await simulator.publish('log', { severity: 0, message: `hardware-info:webcam_did=${did}` });
    await settle(600);
  };

  const camerasOf = async (session: Session, query = ''): Promise<Record<string, any>[]> =>
    (await session.client.get(`/v1/cameras${query}`).expect(200)).body.items;

  const controller = async (session: Session) => {
    const device = await provisionDevice(session, 'controller');
    const simulator = await startSimulator(device);
    simulators.push(simulator);
    await settle();

    return { device, simulator };
  };

  beforeAll(async () => {
    simulators = [];
    first = await createAccount('cameras-first-owner');
    next = await createAccount('cameras-next-owner');
    stranger = await createAccount('cameras-stranger-owner');

    ({ device: sold } = await controller(first));
    ({ device: kept } = await controller(first));
    ({ device: theirs } = await controller(stranger));
  });

  afterAll(async () => {
    for (const simulator of simulators) await simulator.close();
  });

  it('belongs to whoever owns the controller now, and leaves the last owner´s where it died', async () => {
    const [sim] = simulators;
    await pairs(sim, HANDED_ON);

    const [hers] = await camerasOf(first, `?deviceId=${sold.deviceId}`);
    expect(hers).toMatchObject({ ownerId: first.userId, did: HANDED_ON, deviceId: sold.deviceId });

    await first.client.delete(`/v1/devices/${sold.deviceId}/claim`).expect(204);
    await next.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(sold.deviceId) })
      .expect(201);
    await pairs(sim, HANDED_ON);

    const mine = await camerasOf(next);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ ownerId: next.userId, did: HANDED_ON, deviceId: sold.deviceId });
    expect(mine[0].id).not.toBe(hers.id);
    // In the new owner's own tent, with a year of its own and nothing the last
    // owner decided about the camera.
    expect(mine[0].spaceId).toBe((await next.client.get(`/v1/devices/${sold.deviceId}`).expect(200)).body.spaceId);
    expect(mine[0].entitlement.grant).toBe('included');

    // The first owner keeps the pictures she took and nothing else: her row is
    // gone from her cameras, names no device, and is not the one taking them.
    expect((await camerasOf(first)).some(camera => camera.id === hers.id)).toBe(false);
    const buried = (await camerasOf(first, '?includeRemoved=true')).find(camera => camera.id === hers.id);
    expect(buried).toMatchObject({ ownerId: first.userId, deviceId: null });
    expect(buried?.removedAt).not.toBeNull();
    await first.client.get(`/v1/cameras/${mine[0].id}`).expect(404);
  });

  it('is never taken from a device that is still using it', async () => {
    const [, keptSim, strangerSim] = simulators;
    await pairs(keptSim, STILL_IN_USE);
    const [before] = await camerasOf(first, `?deviceId=${kept.deviceId}`);
    expect(before).toMatchObject({ ownerId: first.userId, did: STILL_IN_USE, deviceId: kept.deviceId });

    // The same pairing id on somebody else's controller. Two cameras, as far as
    // this can tell, and the one that is working is left working.
    await pairs(strangerSim, STILL_IN_USE);

    expect(await camerasOf(first, `?deviceId=${kept.deviceId}`)).toEqual([before]);
    const [other] = await camerasOf(stranger, `?deviceId=${theirs.deviceId}`);
    expect(other).toMatchObject({ ownerId: stranger.userId, did: STILL_IN_USE, deviceId: theirs.deviceId });
    expect(other.id).not.toBe(before.id);
  });
});

describe('the composer', () => {
  let camera: string;

  const span = { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-20T00:00:00.000Z' };

  beforeAll(async () => {
    camera = await addCamera(rtsp({ name: 'Composer cam' }));
  });

  it('answers a job that is polled, because a render does not finish inside a request', async () => {
    const asked = await owner.client
      .post(`/v1/cameras/${camera}/timelapses`)
      .send({
        window: 'phase',
        ...span,
        overlays: { dayCounter: true, climate: true, entries: true },
        includeLightsOff: false,
        aspect: '9_16',
      })
      .expect(202);

    expect(asked.body.queued).toBe(true);
    expect(asked.body.media.render).toMatchObject({
      status: 'queued',
      aspect: '9_16',
      includeLightsOff: false,
      overlays: { dayCounter: true, climate: true, entries: true },
    });

    // The row is polled like any other picture, which is what the hourly
    // builder then fills in.
    const polled = await owner.client.get(`/v1/media/${asked.body.media.id}`).expect(200);
    expect(polled.body.id).toBe(asked.body.media.id);
    expect(polled.body.window).toBe('phase');
  });

  it('renders HD without a mark where nothing is enforced, which is what a self-hosted install gets', async () => {
    // `PREMIUM_ENFORCED` is unset here, so every camera reads as entitled. What
    // an install that enforces refuses instead is held in the unit spec.
    const asked = await owner.client
      .post(`/v1/cameras/${camera}/timelapses`)
      .send({ window: 'custom', startsAt: span.startsAt, endsAt: '2026-08-10T00:00:00.000Z', quality: 'hd' })
      .expect(202);

    expect(asked.body.media.quality).toBe('hd');
    expect(asked.body.media.render.watermark).toBe(false);
  });

  it('needs both ends of a span it cannot work out for itself', async () => {
    const refused = await owner.client.post(`/v1/cameras/${camera}/timelapses`).send({ window: 'custom' }).expect(400);

    expect(refused.body.code).toBe('span_missing');
  });

  /**
   * A film is dated by its first frame and runs on after it. One that begins
   * inside a link's window and ends after it is footage of days the grower
   * never sent, so the link neither lists it nor plays it.
   */
  it('gives a link reader only the films that lie inside its window from first frame to last', async () => {
    const filmed = await addCamera(rtsp({ name: 'Windowed cam' }));
    const film = async (startsAt: string, endsAt: string): Promise<string> =>
      (await owner.client.post(`/v1/cameras/${filmed}/timelapses`).send({ window: 'custom', startsAt, endsAt }).expect(202)).body.media.id;
    const inside = await film('2026-08-01T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
    const runsOn = await film('2026-08-08T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
    const startsAtTheEnd = await film('2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z');

    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({
          kind: 'view',
          subject: { type: 'space', id: tent },
          range: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-10T00:00:00.000Z' },
          includeCameras: true,
        })
        .expect(201)
    ).body;

    const listed = (await anonymous().get(`/v1/cameras/${filmed}/timelapses`).set('X-Share-Token', link.token).expect(200)).body.items;
    expect(listed.map((one: { id: string }) => one.id)).toEqual([inside]);

    await anonymous().get(`/v1/media/${inside}?share=${link.token}`).expect(200);
    await anonymous().get(`/v1/media/${runsOn}?share=${link.token}`).expect(404);
    await anonymous().get(`/v1/media/${startsAtTheEnd}?share=${link.token}`).expect(404);

    // The owner reads their own films whole, window or not.
    const own = (await owner.client.get(`/v1/cameras/${filmed}/timelapses`).expect(200)).body.items;
    expect(own).toHaveLength(3);
  });

  it('is somebody with a say over the camera, not everybody who may look at it', async () => {
    const stranger = await createAccount('cameras-composer-stranger');

    await stranger.client
      .post(`/v1/cameras/${camera}/timelapses`)
      .send({ window: 'phase', ...span })
      .expect(404);
  });
});

/**
 * What a camera is to somebody the tent was shared with.
 *
 * A guest is invited to a tent, its grows and its cams - which is the picture
 * and what the camera is called, and never the id the hardware is paired by or
 * the address it answers on at home. These cameras ship with a fixed default
 * login, so an address plus an identity is most of a way in; the demo session
 * has always been answered without them, and a round that let other people into
 * the tent is what made the same redaction owed to everybody who is not the
 * owner.
 */
describe('what somebody the tent is shared with is answered about a camera', () => {
  const DID = 'SIMCAMD827A1';
  const HOME = '192.168.1.40';
  const TUNNEL = 'ffmpeg exited: rtsp://10.8.0.2:8554/tunnelled refused';

  let guest: Session;
  let theirs: string;

  beforeAll(async () => {
    guest = await createAccount('cameras-guest');
    // The stronger of the two roles, so that what is held back is held back
    // from the guest who may do most rather than only from the one who may least.
    await joinSpace(owner, tent, guest, 'can_manage');

    theirs = await addCamera(rtsp({ name: 'The host´s canopy cam', url: `rtsp://viewer:hunter2@${HOME}:554/stream1` }));
    await setRow('cameras', { id: theirs }, { did: DID, uid: 'UID-827A1', ip: HOME, 'state.lastError': TUNNEL });
  });

  it('says what the camera is and nothing about where the host lives', async () => {
    const read = (await guest.client.get(`/v1/cameras/${theirs}`).expect(200)).body;

    expect(read).toMatchObject({ id: theirs, name: 'The host´s canopy cam', kind: 'rtsp', spaceId: tent });
    expect(read.did).toBeNull();
    expect(read.uid).toBeNull();
    expect(read.ip).toBeNull();
    expect(read.url).toBeNull();
    expect(read.state.lastError).toBeNull();

    const said = JSON.stringify(read);
    expect(said).not.toContain(DID);
    expect(said).not.toContain(HOME);
    expect(said).not.toContain('10.8.0.2');
  });

  it('holds the same back in the list, and in the answer to the guest´s own edit', async () => {
    const listed = (await guest.client.get('/v1/cameras?limit=200').expect(200)).body.items.find((one: { id: string }) => one.id === theirs);
    expect(listed).toMatchObject({ did: null, uid: null, ip: null, url: null });
    expect(listed.state.lastError).toBeNull();

    const renamed = (await guest.client.patch(`/v1/cameras/${theirs}`).send({ name: 'Renamed by the guest' }).expect(200)).body;
    expect(renamed).toMatchObject({ name: 'Renamed by the guest', did: null, ip: null, url: null });
  });

  it('is the guest´s standing and not the camera´s: the owner reads their own hardware whole', async () => {
    const mine = (await owner.client.get(`/v1/cameras/${theirs}`).expect(200)).body;

    expect(mine.did).toBe(DID);
    expect(mine.ip).toBe(HOME);
    // Without the credentials, which are nobody's to read back - the address is.
    expect(mine.url).toBe(`rtsp://${HOME}:554/stream1`);
    expect(mine.state.lastError).toBe(TUNNEL);
  });

  it('tells a link reader neither whose camera it is, what it hangs off, nor what the owner paid for', async () => {
    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'space', id: tent }, includeCameras: true })
        .expect(201)
    ).body;

    const read = (await anonymous().get(`/v1/cameras/${theirs}?share=${link.token}`).expect(200)).body;
    expect(read).toMatchObject({ id: theirs, ownerId: null, deviceId: null, did: null, ip: null, url: null });
    expect(read.entitlement).toMatchObject({ validUntil: null, grant: null, renewalVisible: false });
    expect(JSON.stringify(read)).not.toContain(owner.userId);

    // A member of the tent is somebody the owner grows with, and is told both.
    expect((await guest.client.get(`/v1/cameras/${theirs}`).expect(200)).body.ownerId).toBe(owner.userId);
  });
});

/**
 * The camera list is what the Premium screen counts, prices and offers to
 * extend, so what it holds is what somebody will be asked to pay for. An
 * administrator asking for it is asking as themselves; the office reaches one
 * camera by id, and the fleet through its own screens.
 */
describe('the cameras an administrator is listed', () => {
  it('holds none of somebody else´s, although the office may open each of them by id', async () => {
    const admin = await loginAsAdmin();
    const theirs = await addCamera(rtsp({ name: 'Canopy cam' }));

    const listed = (await admin.client.get('/v1/cameras?limit=200').expect(200)).body.items;

    expect(listed.map((one: { id: string }) => one.id)).not.toContain(theirs);
    expect(listed.every((one: { ownerId: string }) => one.ownerId === admin.userId)).toBe(true);

    // Still the office where it is asked to decide about one named camera:
    // somebody has to be able to look at the row a grower is complaining about.
    await admin.client.get(`/v1/cameras/${theirs}`).expect(200);
  });
});
