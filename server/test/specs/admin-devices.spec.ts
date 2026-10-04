import { createAccount, loginAsAdmin, Session } from '../support/api';
import { claimCodeOf, DeviceSimulator, provisionDevice } from '../support/device';

/**
 * The fleet as the install's administrator reads it: every device, whoever
 * owns it - which is what support searches when a customer calls - while the
 * ordinary device list still answers an administrator as the person they are.
 */

let admin: Session;
let customer: Session;
let deviceId: string;

beforeAll(async () => {
  admin = await loginAsAdmin();
  customer = await createAccount('fleet-customer');
  deviceId = (await provisionDevice(customer, 'fridge')).deviceId;
});

const allPages = async (session: Session, path: string): Promise<{ id: string; ownerId: string | null }[]> => {
  const items: { id: string; ownerId: string | null }[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: { id: string; ownerId: string | null }[]; nextCursor: string | null } = (
      await session.client
        .get(path)
        .query({ limit: 200, ...(cursor ? { cursor } : {}) })
        .expect(200)
    ).body;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};

describe('GET /v1/admin/devices', () => {
  it('lists a customer’s device to the administrator, and the customer’s own list keeps it to the customer', async () => {
    const fleet = await allPages(admin, '/v1/admin/devices');
    expect(fleet.find(device => device.id === deviceId)).toMatchObject({ ownerId: customer.userId });

    const own = await allPages(admin, '/v1/devices');
    expect(own.some(device => device.id === deviceId)).toBe(false);
  });

  it('opens the device itself to the administrator, settings and all', async () => {
    const device = (await admin.client.get(`/v1/devices/${deviceId}`).expect(200)).body;
    expect(device).toMatchObject({ id: deviceId, ownerId: customer.userId });
  });

  it('is refused to anybody else', async () => {
    await customer.client.get('/v1/admin/devices').expect(403);
  });
});

describe('POST /v1/admin/devices/provisioned', () => {
  let fridgeClassId: string;

  beforeAll(async () => {
    const classes = (await admin.client.get('/v1/admin/device-classes').query({ limit: 200 }).expect(200)).body;
    fridgeClassId = classes.items.find((entry: { name: string }) => entry.name === 'fridge').id;
  });

  it('makes a device to flash, with the next serial number and broker credentials it can sign in with', async () => {
    const before = await allPages(admin, '/v1/admin/devices');
    const made = (await admin.client.post('/v1/admin/devices/provisioned').send({ classId: fridgeClassId, type: 'fridge' }).expect(201)).body;

    expect(made.device).toMatchObject({ type: 'fridge', classId: fridgeClassId, ownerId: null });
    expect(made.device.serialNumber).toBeGreaterThan(0);
    expect(made.mqtt.username).toEqual(expect.any(String));
    expect(made.mqtt.password).toEqual(expect.any(String));
    expect(before.some(device => device.id === made.device.id)).toBe(false);

    // What the provisioning tool flashes is what the hardware then signs in with.
    const hardware = await new DeviceSimulator({
      deviceId: made.device.id,
      username: made.mqtt.username,
      password: made.mqtt.password,
      deviceType: 'fridge',
    }).connect();
    await hardware.close();

    // And it is claimed like any other: its display asks for a code, which is the whole proof.
    const claimed = (
      await customer.client
        .post('/v1/devices/claims')
        .send({ code: await claimCodeOf(made.device.id) })
        .expect(201)
    ).body;
    expect(claimed.device).toMatchObject({ id: made.device.id, ownerId: customer.userId });
  });

  it('never answers the password again', async () => {
    const made = (await admin.client.post('/v1/admin/devices/provisioned').send({ classId: fridgeClassId, type: 'fridge' }).expect(201)).body;

    const read = await admin.client.get(`/v1/devices/${made.device.id}`).expect(200);
    expect(JSON.stringify(read.body)).not.toContain(made.mqtt.password);
  });

  it('refuses a class that does not exist, which is what decides the build', async () => {
    const refused = await admin.client.post('/v1/admin/devices/provisioned').send({ classId: 'no-such-class', type: 'fridge' }).expect(404);
    expect(refused.body.code).toBe('device_class_not_found');
  });

  it('is refused to anybody else', async () => {
    await customer.client.post('/v1/admin/devices/provisioned').send({ classId: fridgeClassId, type: 'fridge' }).expect(403);
  });
});
