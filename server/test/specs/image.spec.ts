import sharp from 'sharp';
import { anonymous, ApiClient, context, createAccount, loginAsAdmin, Session } from '../support/api';
import { DeviceCredentials, provisionDevice } from '../support/device';
import { storeWebcamStill } from '../support/fixtures';

let owner: Session;
let admin: Session;
let device: DeviceCredentials;

const jpeg = (color: { r: number; g: number; b: number }, width = 320, height = 240): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();

let defaultStill: Buffer;

const upload = (target: DeviceCredentials, session: Session = owner, body?: Buffer, timestamp?: number) => {
  const request = session.client.post(`/image/${target.deviceId}`).attach('image', body ?? defaultStill, 'still.jpg');
  if (timestamp !== undefined) request.field('timestamp', String(timestamp));
  return request;
};

beforeAll(async () => {
  owner = await createAccount('image-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
  defaultStill = await jpeg({ r: 20, g: 120, b: 60 });
});

describe('POST /image/:device_id', () => {
  it('stores an uploaded still', async () => {
    const fresh = await provisionDevice(owner);

    const response = await upload(fresh).expect(201);

    expect(response.body).toEqual({
      image_id: expect.any(String),
      device_id: fresh.deviceId,
      timestamp: expect.any(Number),
      format: 'user/jpeg',
    });
  });

  it('keeps the timestamp the client supplied', async () => {
    const fresh = await provisionDevice(owner);
    const timestamp = Date.now() - 3_600_000;

    const response = await upload(fresh, owner, undefined, timestamp).expect(201);

    expect(response.body.timestamp).toBe(timestamp);
  });

  it('rejects a request without a file', async () => {
    await owner.client.post(`/image/${device.deviceId}`).send({}).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('image-upload-stranger');
    await upload(device, stranger).expect(403);
  });

  it('requires a session', async () => {
    const body = await jpeg({ r: 0, g: 0, b: 0 });
    await anonymous().post(`/image/${device.deviceId}`).attach('image', body, 'still.jpg').expect(401);
  });
});

describe('GET /image/:device_id', () => {
  // Uploads live in their own format namespace, so a diary photo is never
  // mistaken for a webcam still (and vice versa) when reading by timestamp.
  const USER_FORMAT = 'user/jpeg';

  it('serves the newest upload for the owner', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh, owner, await jpeg({ r: 200, g: 30, b: 30 })).expect(201);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: USER_FORMAT }).expect(200);

    expect(response.headers['content-type']).toBe('image/jpeg');
    const metadata = await sharp(response.body).metadata();
    expect(metadata.format).toBe('jpeg');
  });

  it('does not serve an upload to a request for a webcam still', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh).expect(201);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: 'jpeg' }).expect(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it('serves a specific still by its id', async () => {
    const fresh = await provisionDevice(owner);
    const created = await upload(fresh).expect(201);

    const response = await owner.client
      .get(`/image/${fresh.deviceId}`)
      .query({ format: USER_FORMAT, image_id: created.body.image_id })
      .expect(200);

    expect(response.headers['content-type']).toBe('image/jpeg');
  });

  it('falls back to a placeholder when the device has no picture', async () => {
    const fresh = await provisionDevice(owner);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: 'jpeg' }).expect(200);

    expect(response.headers['content-type']).toBe('image/png');
  });

  it('falls back to a placeholder video for an mp4 request', async () => {
    const fresh = await provisionDevice(owner);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: 'mp4' }).expect(200);

    expect(response.headers['content-type']).toBe('video/mp4');
  });

  it('resizes on request, keeping the aspect ratio', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh, owner, await jpeg({ r: 10, g: 10, b: 200 }, 640, 480)).expect(201);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: USER_FORMAT, width: 160 }).expect(200);

    const metadata = await sharp(response.body).metadata();
    expect(metadata.width).toBe(160);
    expect(metadata.height).toBe(120);
  });

  it('never enlarges a picture', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh, owner, await jpeg({ r: 10, g: 10, b: 200 }, 320, 240)).expect(201);

    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: USER_FORMAT, width: 4000 }).expect(200);

    const metadata = await sharp(response.body).metadata();
    expect(metadata.width).toBe(320);
  });

  it('accepts the long-lived image token, which no other endpoint takes', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh).expect(201);

    await new ApiClient(undefined, owner.imageToken).get(`/image/${fresh.deviceId}`).query({ format: 'jpeg' }).expect(200);
  });

  it('accepts an image token in the query string, for <img> tags', async () => {
    const fresh = await provisionDevice(owner);
    await upload(fresh).expect(201);

    await anonymous().get(`/image/${fresh.deviceId}`).query({ format: 'jpeg', token: owner.imageToken }).expect(200);
  });

  it('refuses a query-string token on any other endpoint', async () => {
    await anonymous().get('/device').query({ token: owner.imageToken }).expect(401);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('image-read-stranger');
    await stranger.client.get(`/image/${device.deviceId}`).query({ format: 'jpeg' }).expect(403);
  });

  it('requires some form of access', async () => {
    await anonymous().get(`/image/${device.deviceId}`).query({ format: 'jpeg' }).expect(401);
  });

  describe('through a share link', () => {
    it('serves the webcam still when the link grants the webcam', async () => {
      const fresh = await provisionDevice(owner);
      await upload(fresh).expect(201);
      const share = await owner.client.post('/share').send({ device_id: fresh.deviceId, page: 'charts', webcam: true }).expect(201);

      await anonymous().get(`/image/${fresh.deviceId}`).query({ format: 'jpeg', share: share.body.share_id }).expect(200);
    });

    it('refuses the webcam still when the link does not grant it', async () => {
      const fresh = await provisionDevice(owner);
      await upload(fresh).expect(201);
      const share = await owner.client.post('/share').send({ device_id: fresh.deviceId, page: 'diary' }).expect(201);

      await anonymous().get(`/image/${fresh.deviceId}`).query({ format: 'jpeg', share: share.body.share_id }).expect(403);
    });

    it('still serves a diary photo addressed by its id', async () => {
      const fresh = await provisionDevice(owner);
      const created = await upload(fresh).expect(201);
      const share = await owner.client.post('/share').send({ device_id: fresh.deviceId, page: 'diary' }).expect(201);

      const response = await anonymous()
        .get(`/image/${fresh.deviceId}`)
        .query({ format: USER_FORMAT, image_id: created.body.image_id, share: share.body.share_id })
        .expect(200);

      expect(response.headers['content-type']).toBe('image/jpeg');
    });
  });
});

describe('a webcam still that has gone stale', () => {
  // Ten minutes without a sample is what counts as offline.
  const ONLINE_TIMEOUT_MS = 10 * 60 * 1000;

  /** How dark the picture is, which is what the overlay changes. */
  const brightness = async (body: Buffer): Promise<number> => (await sharp(body).stats()).channels[0].mean;

  it('carries the offline notice, and a fresh one does not', async () => {
    const fresh = await provisionDevice(owner);
    const still = await jpeg({ r: 240, g: 240, b: 240 });

    await storeWebcamStill(fresh.deviceId, still, Date.now());
    const recent = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: 'jpeg' }).expect(200);

    const stale = await provisionDevice(owner);
    await storeWebcamStill(stale.deviceId, still, Date.now() - ONLINE_TIMEOUT_MS - 60_000);
    const old = await owner.client.get(`/image/${stale.deviceId}`).query({ format: 'jpeg' }).expect(200);

    // The notice is drawn over a dimmed copy of the picture, so the stale one
    // comes back darker than the very same image served fresh.
    expect(await brightness(recent.body)).toBeCloseTo(await brightness(still), 0);
    expect(await brightness(old.body)).toBeLessThan((await brightness(still)) - 20);
  });

  it('leaves a picture asked for by its id alone, however old it is', async () => {
    const device = await provisionDevice(owner);
    const still = await jpeg({ r: 240, g: 240, b: 240 });
    const stored = await storeWebcamStill(device.deviceId, still, Date.now() - ONLINE_TIMEOUT_MS - 60_000);

    const response = await owner.client
      .get(`/image/${device.deviceId}`)
      .query({ format: 'jpeg', image_id: stored.imageId })
      .expect(200);

    expect(await brightness(response.body)).toBeCloseTo(await brightness(still), 0);
  });
});

describe('DELETE /image/:image_id', () => {
  it('removes a still of the caller´s device', async () => {
    const fresh = await provisionDevice(owner);
    const created = await upload(fresh).expect(201);

    await owner.client.delete(`/image/${created.body.image_id}`).expect(200);

    // Gone: the endpoint now serves the placeholder instead.
    const response = await owner.client.get(`/image/${fresh.deviceId}`).query({ format: 'jpeg' }).expect(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it('reports an unknown image as not found', async () => {
    await owner.client.delete('/image/no-such-image').expect(404);
  });

  it('refuses a still that belongs to another user´s device', async () => {
    const fresh = await provisionDevice(owner);
    const created = await upload(fresh).expect(201);
    const stranger = await createAccount('image-delete-stranger');

    await stranger.client.delete(`/image/${created.body.image_id}`).expect(403);
  });

  it('lets an admin delete any still', async () => {
    const fresh = await provisionDevice(owner);
    const created = await upload(fresh).expect(201);

    await admin.client.delete(`/image/${created.body.image_id}`).expect(200);
  });
});

describe('POST /image/test/:device_id', () => {
  it('answers with a frame read from the stream', async () => {
    const response = await owner.client
      .post(`/image/test/${device.deviceId}`)
      .send({ rtspStream: `${context.controlUrl}/__control/stream.mp4` })
      .expect(200);

    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await sharp(response.body).metadata()).format).toBe('jpeg');
  });

  it('rejects a request without a stream url', async () => {
    await owner.client.post(`/image/test/${device.deviceId}`).send({}).expect(400);
    await owner.client.post(`/image/test/${device.deviceId}`).send({ rtspStream: '   ' }).expect(400);
  });

  it('reports a stream it cannot read as a bad gateway', async () => {
    const response = await owner.client
      .post(`/image/test/${device.deviceId}`)
      .send({ rtspStream: 'rtsp://127.0.0.1:1/nothing-here' })
      .expect(502);

    expect(response.body.message).toEqual(expect.any(String));
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('image-test-stranger');
    await stranger.client.post(`/image/test/${device.deviceId}`).send({ rtspStream: 'rtsp://127.0.0.1:1/x' }).expect(403);
  });
});
