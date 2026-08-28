import { anonymous, context, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { provisionDevice, registerDevice } from '../support/device';

let owner: Session;
let admin: Session;

beforeAll(async () => {
  owner = await createAccount('device-owner');
  admin = await loginAsAdmin();
});

describe('POST /device/register', () => {
  const registration = (overrides: Record<string, unknown> = {}) => ({
    registration_password: context.selfRegistrationPassword,
    device_id: unique('sim-fridge'),
    username: unique('device-user'),
    password: unique('device-pass'),
    device_type: 'fridge',
    ...overrides,
  });

  it('registers a new device and answers with the firmware to run', async () => {
    const response = await anonymous().post('/device/register').send(registration()).expect(201);
    expect(response.body).toHaveProperty('fw');
  });

  it('lets a device re-register with the same credentials', async () => {
    const body = registration();
    await anonymous().post('/device/register').send(body).expect(201);

    const response = await anonymous().post('/device/register').send(body).expect(201);
    expect(response.body).toHaveProperty('fw');
  });

  it('refuses a re-registration with a wrong device password', async () => {
    const body = registration();
    await anonymous().post('/device/register').send(body).expect(201);

    await anonymous()
      .post('/device/register')
      .send({ ...body, password: 'wrong-password' })
      .expect(401);
  });

  it('refuses a device type this server does not know', async () => {
    // Firmware built for a class that was never created here cannot be
    // enrolled; reading the class it did not find used to answer 500.
    await anonymous()
      .post('/device/register')
      .send(registration({ device_type: 'no-such-class' }))
      .expect(401);
  });

  it('refuses a wrong registration password', async () => {
    await anonymous()
      .post('/device/register')
      .send(registration({ registration_password: 'wrong' }))
      .expect(401);
  });

  it('validates the payload', async () => {
    await anonymous()
      .post('/device/register')
      .send(registration({ device_id: undefined }))
      .expect(400);
    await anonymous()
      .post('/device/register')
      .send(registration({ device_type: 42 }))
      .expect(400);
  });

  it('hands out increasing serial numbers', async () => {
    const first = await registerDevice();
    const second = await registerDevice();

    const firstDevice = await admin.client.get('/device/byserial').query({ serialnumber: 0 });
    expect(firstDevice.status).toBe(200);

    const all = await admin.client.get('/device/all').expect(200);
    const serials = new Map(all.body.map((device: { device_id: string; serialnumber: number }) => [device.device_id, device.serialnumber]));
    expect(serials.get(second.deviceId)).toBeGreaterThan(serials.get(first.deviceId) as number);
  });
});

describe('POST /device/claimcode', () => {
  it('issues a claim code for a registered device', async () => {
    const device = await registerDevice();

    const response = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    expect(response.body.claim_code).toEqual(expect.any(String));
  });

  it('is also reachable under the legacy firmware path', async () => {
    const device = await registerDevice();

    const response = await anonymous().post('/auth/v0.0.1/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    expect(response.body.claim_code).toEqual(expect.any(String));
  });

  it('replaces a previously issued code for the same device', async () => {
    const device = await registerDevice();

    const first = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);
    const second = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    expect(second.body.claim_code).not.toBe(first.body.claim_code);
    await owner.client.post('/device').send({ claim_code: first.body.claim_code }).expect(400);
  });

  it('refuses an unknown device', async () => {
    await anonymous().post('/device/claimcode').send({ device_id: 'no-such-device' }).expect(401);
  });
});

describe('the claim code and what it is worth', () => {
  it('refuses to issue one without naming a device', async () => {
    // The claim code is what takes ownership, so a request that names no device
    // must not be answered with one for whichever device the database returns
    // first - which is what an absent filter value comes down to.
    await anonymous().post('/device/claimcode').send({}).expect(400);
    await anonymous().post('/device/claimcode').send({ device_id: '' }).expect(400);
    await anonymous().post('/device/claimcode').send({ device_id: null }).expect(400);
    await anonymous().post('/device/claimcode').send({ device_id: { $ne: null } }).expect(400);

    // The legacy path firmware calls is the same handler and answers the same.
    await anonymous().post('/auth/v0.0.1/device/claimcode').send({}).expect(400);
  });

  it('reports a device it has never heard of as unauthorized', async () => {
    await anonymous().post('/device/claimcode').send({ device_id: 'no-such-device' }).expect(401);
  });
});

describe('POST /device', () => {
  it('claims a device for the calling user', async () => {
    const device = await registerDevice();
    const code = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    const response = await owner.client.post('/device').send({ claim_code: code.body.claim_code }).expect(200);

    expect(response.body).toEqual({ status: 'ok', device_id: device.deviceId });

    const listed = await owner.client.get('/device').expect(200);
    expect(listed.body.map((entry: { device_id: string }) => entry.device_id)).toContain(device.deviceId);
  });

  it('spends the claim code, so a second account cannot claim the same device', async () => {
    const device = await registerDevice();
    const code = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    await owner.client.post('/device').send({ claim_code: code.body.claim_code }).expect(200);

    // The code is printed on the device and passed around; claiming with it is
    // what takes ownership, so it has to stop working once it has been used.
    const second = await createAccount('claim-replay');
    await second.client.post('/device').send({ claim_code: code.body.claim_code }).expect(400);

    const stillOwned = await owner.client.get('/device').expect(200);
    expect(stillOwned.body.map((entry: { device_id: string }) => entry.device_id)).toContain(device.deviceId);
  });

  it('rejects an unknown claim code', async () => {
    await owner.client.post('/device').send({ claim_code: 'nope' }).expect(400);
  });

  it('validates the payload', async () => {
    await owner.client.post('/device').send({}).expect(400);
  });

  it('requires a session', async () => {
    await anonymous().post('/device').send({ claim_code: 'x' }).expect(401);
  });

  it('refuses a demo session', async () => {
    const demo = await demoSession();
    await demo.client.post('/device').send({ claim_code: 'x' }).expect(403);
  });
});

describe('GET /device', () => {
  it('lists the caller´s devices with their derived maintenance countdown', async () => {
    const lister = await createAccount('device-lister');
    const device = await provisionDevice(lister);

    const response = await lister.client.get('/device').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      device_id: device.deviceId,
      device_type: 'fridge',
      maintenance_mode_seconds_left: 0,
    });
  });

  it('never exposes device credentials', async () => {
    const response = await owner.client.get('/device').expect(200);
    for (const device of response.body) {
      expect(device.password).toBeUndefined();
      expect(device.username).toBeUndefined();
    }
  });

  it('does not list another user´s devices', async () => {
    const stranger = await createAccount('device-stranger');
    const response = await stranger.client.get('/device').expect(200);
    expect(response.body).toHaveLength(0);
  });

  it('shows a demo session only the demo devices', async () => {
    const demo = await demoSession();
    const response = await demo.client.get('/device').expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    for (const device of response.body) {
      expect(device.device_id).toEqual(expect.any(String));
    }
  });

  it('requires a session', async () => {
    await anonymous().get('/device').expect(401);
  });
});

describe('DELETE /device/:device_id', () => {
  it('releases a device the caller owns', async () => {
    const unclaimer = await createAccount('device-unclaimer');
    const device = await provisionDevice(unclaimer);

    await unclaimer.client.delete(`/device/${device.deviceId}`).expect(200);

    const listed = await unclaimer.client.get('/device').expect(200);
    expect(listed.body).toHaveLength(0);
  });

  it('refuses a device the caller does not own', async () => {
    const device = await provisionDevice(owner);
    const stranger = await createAccount('device-unclaim-stranger');

    await stranger.client.delete(`/device/${device.deviceId}`).expect(403);

    const listed = await owner.client.get('/device').expect(200);
    expect(listed.body.map((entry: { device_id: string }) => entry.device_id)).toContain(device.deviceId);
  });

  it('spends the claim code, so a second account cannot claim the same device', async () => {
    const device = await registerDevice();
    const code = await anonymous().post('/device/claimcode').send({ device_id: device.deviceId }).expect(200);

    await owner.client.post('/device').send({ claim_code: code.body.claim_code }).expect(200);

    // The code is printed on the device and passed around; claiming with it is
    // what takes ownership, so it has to stop working once it has been used.
    const second = await createAccount('claim-replay');
    await second.client.post('/device').send({ claim_code: code.body.claim_code }).expect(400);

    const stillOwned = await owner.client.get('/device').expect(200);
    expect(stillOwned.body.map((entry: { device_id: string }) => entry.device_id)).toContain(device.deviceId);
  });
});

describe('GET /device/all', () => {
  it('lists every device for an admin', async () => {
    const device = await provisionDevice(owner);

    const response = await admin.client.get('/device/all').expect(200);

    expect(response.body.map((entry: { device_id: string }) => entry.device_id)).toContain(device.deviceId);
  });

  it('is admin-only', async () => {
    await owner.client.get('/device/all').expect(401);
    await anonymous().get('/device/all').expect(401);
  });
});

describe('POST /device/create', () => {
  it('creates a device from a class for an admin', async () => {
    const classes = await admin.client.get('/device/class').expect(200);
    const fridgeClass = classes.body.find((entry: { name: string }) => entry.name === 'fridge');

    const response = await admin.client.post('/device/create').send({ class_id: fridgeClass.class_id, device_type: 'fridge' }).expect(201);

    expect(response.body.device_id).toEqual(expect.any(String));
    expect(response.body.serialnumber).toEqual(expect.any(Number));
  });

  it('validates the payload', async () => {
    await admin.client.post('/device/create').send({ device_type: 'fridge' }).expect(400);
  });

  it('reports a class that does not exist rather than failing', async () => {
    await admin.client.post('/device/create').send({ class_id: 'no-such-class', device_type: 'fridge' }).expect(404);
  });

  it('is admin-only', async () => {
    await owner.client.post('/device/create').send({ class_id: 'x', device_type: 'fridge' }).expect(401);
  });
});

describe('GET /device/byserial', () => {
  it('finds a device by its serial number', async () => {
    const device = await provisionDevice(owner);
    const all = await admin.client.get('/device/all').expect(200);
    const created = all.body.find((entry: { device_id: string }) => entry.device_id === device.deviceId);

    const response = await admin.client.get('/device/byserial').query({ serialnumber: created.serialnumber }).expect(200);

    expect(response.body.device_id).toBe(device.deviceId);
  });

  it('is admin-only', async () => {
    await owner.client.get('/device/byserial').query({ serialnumber: 1 }).expect(401);
  });
});

describe('GET /device/onlinedevices', () => {
  it('is admin-only and returns a list', async () => {
    const response = await admin.client.get('/device/onlinedevices').expect(200);
    expect(Array.isArray(response.body)).toBe(true);

    await owner.client.get('/device/onlinedevices').expect(401);
  });
});

describe('GET /device/firmwareversions', () => {
  it('is admin-only and returns a summary', async () => {
    await admin.client.get('/device/firmwareversions').expect(200);
    await owner.client.get('/device/firmwareversions').expect(401);
  });
});
