import { anonymous, createAccount, Session } from '../support/api';
import { provisionDevice } from '../support/device';

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

  it('is somebody with a say over the camera, not everybody who may look at it', async () => {
    const stranger = await createAccount('cameras-composer-stranger');

    await stranger.client
      .post(`/v1/cameras/${camera}/timelapses`)
      .send({ window: 'phase', ...span })
      .expect(404);
  });
});
