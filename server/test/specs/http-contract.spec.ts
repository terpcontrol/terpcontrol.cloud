import sharp from 'sharp';
import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { provisionDevice } from '../support/device';

/**
 * What the HTTP layer promises, independent of any one endpoint: the plugin
 * defaults that replaced the Express middleware do not all match it, and none
 * of these are visible through a route's own specs.
 */
let admin: Session;

beforeAll(async () => {
  admin = await loginAsAdmin();
});

describe('cross-origin access', () => {
  it('allows the verbs the API actually offers on a preflight', async () => {
    const response = await anonymous()
      .request('options', '/device')
      .set('Origin', 'https://app.test.invalid')
      .set('Access-Control-Request-Method', 'DELETE')
      .expect(204);

    const allowed = String(response.headers['access-control-allow-methods']).split(',').map(method => method.trim());
    expect(allowed).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));
  });

  it('lets another origin read a picture, which the webapp loads in an img tag', async () => {
    const owner = await createAccount('cors-owner');
    const device = await provisionDevice(owner);

    const response = await owner.client.get(`/image/${device.deviceId}`).query({ format: 'jpeg' }).expect(200);

    // Anything stricter than cross-origin stops the browser handing the bytes
    // to the page, even though the request itself succeeded.
    const policy = response.headers['cross-origin-resource-policy'];
    expect(policy === undefined || policy === 'cross-origin').toBe(true);
  });
});

describe('security headers', () => {
  it('still sends the ones the API always sent', async () => {
    const response = await anonymous().get('/').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('firmware downloads', () => {
  it('are never compressed, whatever the client offers', async () => {
    const created = await admin.client.post('/device/firmware').send({ name: 'fridge', version: unique('v') }).expect(200);
    const payload = Buffer.alloc(4096, 0x5a);

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', payload, 'firmware.bin')
      .expect(200);

    // The OTA client reads Content-Length and is told not to transform the
    // body; compressing it would break both promises.
    const response = await anonymous()
      .get(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .set('Accept-Encoding', 'gzip, deflate, br')
      .expect(200);

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-length']).toBe(String(payload.length));
    expect(response.headers['cache-control']).toBe('no-transform');
    expect(Buffer.from(response.body)).toEqual(payload);
  });
});

describe('what Express used to accept', () => {
  it('matches a route with a trailing slash', async () => {
    await anonymous().get('/readycheck/').expect(200);

    const owner = await createAccount('slash-owner');
    await owner.client.get('/device/').expect(200);
  });

  it('lets a demo session reach the session endpoints with a trailing slash', async () => {
    const demo = await demoSession();
    await demo.client.post('/logout/').expect(200);
  });

  it('reads an empty body with a JSON content type as an empty object', async () => {
    const owner = await createAccount('empty-body-owner');

    await owner.client.post('/logout').set('Content-Type', 'application/json').send('').expect(200);
    await anonymous().post('/demologin').set('Content-Type', 'application/json').send('').expect(200);
  });

  it('takes the last value of a repeated query parameter', async () => {
    const owner = await createAccount('repeated-query-owner');
    const device = await provisionDevice(owner);

    // A client that builds its URL badly used to be tolerated by hpp(); the
    // token is read as a string, and an array would fail the session check.
    await anonymous()
      .get(`/image/${device.deviceId}?format=jpeg&token=nonsense&token=${owner.imageToken}`)
      .expect(200);
  });
});

describe('refusing a caller', () => {
  it('answers a missing session with the JSON body clients parse', async () => {
    const response = await anonymous().post('/device/setname').send({ device_id: 'whatever', name: 'x' }).expect(401);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.message).toBe('Authentication token missing');
  });

  it('checks the session before the payload', async () => {
    // A caller with no session hears about that, not about the field it forgot.
    await anonymous().post('/device/setname').send({}).expect(401);
  });

  it('answers a device that is not the caller´s with the plain text it always did', async () => {
    const stranger = await createAccount('refusal-stranger');
    const owner = await createAccount('refusal-owner');
    const device = await provisionDevice(owner);

    const response = await stranger.client.post('/device/setname').send({ device_id: device.deviceId, name: 'x' }).expect(403);

    expect(response.text).toBe(`Device ${device.deviceId} not bound to user ${stranger.userId}`);
  });
});

describe('deleting a picture', () => {
  it('does not tell a stranger which picture ids exist', async () => {
    const owner = await createAccount('probe-owner');
    const device = await provisionDevice(owner);
    const still = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const uploaded = await owner.client.post(`/image/${device.deviceId}`).attach('image', still, 'still.jpg').expect(201);

    const existing = await anonymous().delete(`/image/${uploaded.body.image_id}`);
    const missing = await anonymous().delete('/image/no-such-image');

    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
  });
});

describe('thumbnails', () => {
  it('resizes the placeholder too, so a device without a picture still fits the tile', async () => {
    const owner = await createAccount('placeholder-owner');
    const device = await provisionDevice(owner);

    const response = await owner.client.get(`/image/${device.deviceId}`).query({ format: 'jpeg', width: 64 }).expect(200);

    expect(Number(response.headers['content-length'])).toBeLessThan(20_000);
  });
});
