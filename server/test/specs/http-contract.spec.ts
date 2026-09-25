import { request as httpRequest } from 'node:http';
import { anonymous, context, createAccount, loginAsAdmin, Session, unique } from '../support/api';
import { provisionDevice, registerDevice } from '../support/device';

/**
 * What the HTTP layer promises, independent of any one endpoint: the plugin
 * defaults that replaced the Express middleware do not all match it, and none
 * of these are visible through a route's own specs.
 */
let admin: Session;

beforeAll(async () => {
  admin = await loginAsAdmin();
});

/** A body-less POST framed with Transfer-Encoding rather than Content-Length. */
const postChunked = (path: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = new URL(path, context.baseUrl);
    const call = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json' } },
      response => {
        response.resume();
        // An answer that was read to its end has a status.
        response.on('end', () => resolve(response.statusCode!));
      },
    );
    call.on('error', reject);
    call.end();
  });

/** A registered build with one image in it, which is what OTA downloads. */
const uploadFirmware = async (image: Buffer): Promise<string> => {
  const classes = await admin.client.get('/v1/admin/device-classes').expect(200);
  const fridge = classes.body.items.find((entry: { name: string }) => entry.name === 'fridge');

  const created = await admin.client
    .post('/v1/admin/firmwares')
    .send({ classId: fridge.id, name: 'fridge', version: unique('v') })
    .expect(201);

  await admin.client
    .put(`/v1/admin/firmwares/${created.body.id}/binaries/firmware.bin`)
    .send({ data: image.toString('base64') })
    .expect(204);

  return created.body.id;
};

describe('cross-origin access', () => {
  it('allows the verbs the API actually offers on a preflight', async () => {
    const response = await anonymous()
      .request('options', '/v1/devices')
      .set('Origin', 'https://app.test.invalid')
      .set('Access-Control-Request-Method', 'DELETE')
      .expect(204);

    const allowed = String(response.headers['access-control-allow-methods'])
      .split(',')
      .map(method => method.trim());
    expect(allowed).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));
  });

  it('lets another origin read what it answers, which is how the app loads a picture in an img tag', async () => {
    const response = await anonymous().get('/healthz').expect(200);

    // Anything stricter than cross-origin stops the browser handing the bytes
    // to the page, even though the request itself succeeded.
    const policy = response.headers['cross-origin-resource-policy'];
    expect(policy === undefined || policy === 'cross-origin').toBe(true);
  });
});

describe('security headers', () => {
  it('still sends the ones the API always sent', async () => {
    const response = await anonymous().get('/healthz').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('firmware downloads', () => {
  it('are never compressed, whatever the client offers', async () => {
    const payload = Buffer.alloc(4096, 0x5a);
    const firmwareId = await uploadFirmware(payload);

    // The OTA client reads Content-Length and is told not to transform the
    // body; compressing it would break both promises.
    const response = await anonymous().get(`/device/firmware/${firmwareId}/firmware.bin`).set('Accept-Encoding', 'gzip, deflate, br').expect(200);

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-length']).toBe(String(payload.length));
    expect(response.headers['cache-control']).toBe('no-transform');
    expect(Buffer.from(response.body)).toEqual(payload);
  });

  it('round-trips the bytes through the base64 an upload carries them as', async () => {
    // Every byte value, so a decode that went through a string somewhere shows
    // up as a difference rather than as a shorter file that still works.
    const payload = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));
    const firmwareId = await uploadFirmware(payload);

    const response = await anonymous().get(`/device/firmware/${firmwareId}/firmware.bin`).expect(200);
    expect(Buffer.from(response.body)).toEqual(payload);
  });

  it('refuses a file that did not arrive as base64', async () => {
    const classes = await admin.client.get('/v1/admin/device-classes').expect(200);
    const fridge = classes.body.items.find((entry: { name: string }) => entry.name === 'fridge');
    const created = await admin.client
      .post('/v1/admin/firmwares')
      .send({ classId: fridge.id, name: 'fridge', version: unique('v') })
      .expect(201);

    const response = await admin.client
      .put(`/v1/admin/firmwares/${created.body.id}/binaries/firmware.bin`)
      .send({ data: 'not base64!!' })
      .expect(400);

    expect(response.body.code).toBe('binary_not_base64');
  });
});

describe('what Express used to accept', () => {
  it('matches a route with a trailing slash', async () => {
    await anonymous().get('/readyz/').expect(200);

    const owner = await createAccount('slash-owner');
    await owner.client.get('/v1/devices/').expect(200);
  });

  it('matches a route whatever its case', async () => {
    await anonymous().get('/ReadyZ').expect(200);
  });

  it('refuses in the shape the path it matched promises, whatever its case', async () => {
    // The router ignores case, and which half of the API a refusal is answered
    // in is decided from the path - so `/V1/` has to read as `/v1/` there too.
    const response = await anonymous().get('/V1/devices').expect(401);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.code).toBe('unauthenticated');
  });

  it('takes a path segment longer than a hundred characters', async () => {
    // Fastify caps one at 100 by default. The MQTT auth secret travels in the
    // path, so a long one would 414 every check the broker makes.
    const secret = 'x'.repeat(120);
    const response = await anonymous().post(`/mqttauth/${secret}/user`).type('form').send({ username: 'nobody', password: 'nope' });

    expect(response.status).toBe(401);
    expect(response.text).toBe('deny');
  });

  it('reads an empty body with a JSON content type as an empty object', async () => {
    await anonymous().post('/v1/sessions/demo').set('Content-Type', 'application/json').send('').expect(201);
  });

  it('reads an empty chunked body the same way', async () => {
    // A client that streams its body sends no Content-Length, so the emptiness
    // is only visible once the body has been read.
    const status = await postChunked('/v1/sessions/demo');
    expect(status).toBe(201);
  });

  it('takes the last value of a repeated form field', async () => {
    const device = await registerDevice();

    // hpp() collapsed a form-encoded body. The password is handed to bcrypt,
    // which wants a string: an array is a 500 where the broker expects a verdict.
    const response = await anonymous()
      .post(`/mqttauth/${context.mqttAuthSecret}/user`)
      .type('form')
      .send(`username=${encodeURIComponent(device.username)}&password=wrong&password=${encodeURIComponent(device.password)}&vhost=/`)
      .expect(200);

    expect(response.text).toBe('allow');
  });
});

describe('a query parameter that names a list', () => {
  it('carries every value it was repeated with', async () => {
    const owner = await createAccount('repeated-query-owner');
    const device = await provisionDevice(owner);

    const response = await owner.client
      .get(`/v1/devices/${device.deviceId}/series`)
      .query({ startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date().toISOString() })
      .query('metrics=temperature&metrics=humidity&outputs=heater')
      .expect(200);

    expect(response.body.metrics.map((series: { metric: string }) => series.metric)).toEqual(['temperature', 'humidity']);
    expect(response.body.outputs.map((series: { output: string }) => series.output)).toEqual(['heater']);
  });
});

describe('the media token in a URL', () => {
  it('signs a request for a picture in, because an img tag sends no headers', async () => {
    const owner = await createAccount('media-token-owner');

    // Not 401: the token was taken as a session, and the picture is simply not
    // there. Nothing else accepts a token in the query string.
    await anonymous().get(`/v1/media/no-such-picture/content?token=${owner.imageToken}`).expect(404);
    await anonymous().get('/v1/media/no-such-picture/content').expect(404);
    await anonymous().get(`/v1/devices?token=${owner.imageToken}`).expect(401);
  });

  it('is read as the last value where a client repeated it', async () => {
    const owner = await createAccount('media-token-repeat-owner');

    // A client that builds its URL badly used to be tolerated by hpp(); the
    // token is read as a string, and an array would fail the session check.
    await anonymous().get(`/v1/media/no-such-picture/content?token=nonsense&token=${owner.imageToken}`).expect(404);
  });
});

describe('refusing a caller', () => {
  it('answers a missing session with the problem document clients parse', async () => {
    const response = await anonymous().post('/v1/devices/whatever/commands').send({ kind: 'reboot' }).expect(401);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({ status: 401, code: 'unauthenticated', errors: [] });
    expect(typeof response.body.detail).toBe('string');
  });

  it('checks the session before the payload', async () => {
    // A caller with no session hears about that, not about the field it forgot.
    await anonymous().post('/v1/devices/whatever/commands').send({}).expect(401);
  });

  it('tells a stranger that somebody else´s device is not there', async () => {
    const stranger = await createAccount('refusal-stranger');
    const owner = await createAccount('refusal-owner');
    const device = await provisionDevice(owner);

    const response = await stranger.client.patch(`/v1/devices/${device.deviceId}`).send({ name: 'x' }).expect(404);

    // Not "forbidden": a refusal must not report whether something exists to
    // somebody who is not allowed to know.
    expect(response.body.code).toBe('device_not_found');
  });

  it('does not serve a refusal as a document, since it may repeat the URL back', async () => {
    const stranger = await createAccount('refusal-markup-stranger');
    const markup = '<img src=x onerror=alert(1)>';

    const response = await stranger.client.get(`/v1/devices/${encodeURIComponent(markup)}`).expect(404);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
  });
});

/**
 * A range the wrong way round is one mistake, and every route that takes a
 * range reports it the same way: refused, naming the end that came first.
 * Answered, it was an empty list or an empty curve on three routes and a
 * refusal naming the start on the fourth.
 */
describe('a range that ends before it begins', () => {
  const LATER = '2026-03-20T00:00:00.000Z';
  const EARLIER = '2026-03-10T00:00:00.000Z';

  it('is refused alike wherever a range is asked for', async () => {
    const owner = await createAccount('reversed-range');
    const device = await provisionDevice(owner, 'controller');
    const tent = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
    const grow = (await owner.client.post('/v1/grows').send({ name: 'Backwards', type: 'photoperiod', plants: [], spaceId: tent }).expect(201)).body;
    const camera = (
      await owner.client.post('/v1/cameras').send({ kind: 'rtsp', spaceId: tent, name: 'Cam', url: 'rtsp://10.0.0.30:554/s' }).expect(201)
    ).body.id;

    const asked: [string, string][] = [
      [`/v1/devices/${device.deviceId}/series?metrics=temperature&startsAt=${LATER}&endsAt=${EARLIER}`, 'endsAt'],
      [`/v1/entries?growId=${grow.id}&startsAt=${LATER}&endsAt=${EARLIER}`, 'endsAt'],
      [`/v1/cameras/${camera}/frames?startsAt=${LATER}&endsAt=${EARLIER}`, 'endsAt'],
      [`/v1/cameras/${camera}/timelapses?startsAt=${LATER}&endsAt=${EARLIER}`, 'endsAt'],
      [`/v1/grows/${grow.id}/series?range=custom&metrics=temperature&from=${LATER}&to=${EARLIER}`, 'to'],
    ];

    for (const [path, end] of asked) {
      const refused = await owner.client.get(path).expect(400);
      expect(refused.body).toMatchObject({ code: 'validation_failed', errors: [expect.objectContaining({ field: end })] });
    }

    // A range whose ends meet is one instant, and both ends count as inside.
    await owner.client.get(`/v1/entries?growId=${grow.id}&startsAt=${EARLIER}&endsAt=${EARLIER}`).expect(200);
  });
});
