import { createAccount, loginAsAdmin, Session } from '../support/api';
import { provisionDevice } from '../support/device';

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
