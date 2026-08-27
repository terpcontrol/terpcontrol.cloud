import { anonymous, createAccount, loginAsAdmin, Session } from '../support/api';
import { DeviceCredentials, provisionDevice } from '../support/device';

let owner: Session;
let admin: Session;
let device: DeviceCredentials;

const entry = (overrides: Record<string, unknown> = {}) => ({
  message: 'Watered the plants',
  severity: 0,
  categories: ['diary'],
  time: Date.now(),
  ...overrides,
});

const addEntry = (target: DeviceCredentials, overrides: Record<string, unknown> = {}) =>
  owner.client.post(`/device/logs/${target.deviceId}`).send(entry(overrides));

beforeAll(async () => {
  owner = await createAccount('logs-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
});

describe('POST /device/logs/:device_id', () => {
  it('appends an entry that then shows up in the diary', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'First entry' }).expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);

    expect(logs.body).toHaveLength(1);
    expect(logs.body[0]).toMatchObject({ message: 'First entry', severity: 0, categories: ['diary'] });
    // The title falls back to the message when the client does not send one.
    expect(logs.body[0].title).toBe('First entry');
  });

  it('accepts an entry that carries only a title', async () => {
    const fresh = await provisionDevice(owner);
    await owner.client
      .post(`/device/logs/${fresh.deviceId}`)
      .send({ title: 'Title only', severity: 0, categories: ['diary'], time: Date.now() })
      .expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(logs.body[0].title).toBe('Title only');
  });

  it('rejects an entry without a message or a title', async () => {
    await owner.client
      .post(`/device/logs/${device.deviceId}`)
      .send({ severity: 0, categories: ['diary'], time: Date.now() })
      .expect(400);
  });

  it('rejects a non-numeric severity', async () => {
    await addEntry(device, { severity: 'high' }).expect(400);
  });

  it('rejects a missing or empty category list', async () => {
    await addEntry(device, { categories: [] }).expect(400);
    await addEntry(device, { categories: undefined }).expect(400);
  });

  it('rejects an entry without a time', async () => {
    await addEntry(device, { time: undefined }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('logs-stranger');
    await stranger.client.post(`/device/logs/${device.deviceId}`).send(entry()).expect(403);
  });
});

describe('GET /device/logs/:device_id', () => {
  it('returns entries oldest first', async () => {
    const fresh = await provisionDevice(owner);
    const base = Date.now() - 60_000;

    await addEntry(fresh, { message: 'Older', time: base }).expect(200);
    await addEntry(fresh, { message: 'Newer', time: base + 30_000 }).expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(logs.body.map((log: { message: string }) => log.message)).toEqual(['Older', 'Newer']);
  });

  it('filters by time range', async () => {
    const fresh = await provisionDevice(owner);
    const base = Date.now() - 3_600_000;

    await addEntry(fresh, { message: 'Long ago', time: base }).expect(200);
    await addEntry(fresh, { message: 'Recent', time: base + 1_800_000 }).expect(200);

    const logs = await owner.client
      .get(`/device/logs/${fresh.deviceId}`)
      .query({ from: base + 900_000, to: Date.now() })
      .expect(200);

    expect(logs.body.map((log: { message: string }) => log.message)).toEqual(['Recent']);
  });

  it('filters by category', async () => {
    const fresh = await provisionDevice(owner);

    await addEntry(fresh, { message: 'A diary note', categories: ['diary'] }).expect(200);
    await addEntry(fresh, { message: 'A device note', categories: ['device'] }).expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ categories: 'device' }).expect(200);
    expect(logs.body.map((log: { message: string }) => log.message)).toEqual(['A device note']);
  });

  it('labels an entry without categories as unknown', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { categories: ['diary'] }).expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(logs.body[0].categories).toEqual(['diary']);
  });

  it('hides deleted entries unless they are asked for', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Visible' }).expect(200);
    await addEntry(fresh, { message: 'Hidden', deleted: true }).expect(200);

    const visible = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(visible.body.map((log: { message: string }) => log.message)).toEqual(['Visible']);

    const all = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ deleted: true }).expect(200);
    expect(all.body.map((log: { message: string }) => log.message)).toEqual(expect.arrayContaining(['Visible', 'Hidden']));
  });

  it('lets a share link read the diary', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Shared note' }).expect(200);
    const share = await owner.client.post('/share').send({ device_id: fresh.deviceId, page: 'diary' }).expect(201);

    const logs = await anonymous().get(`/device/logs/${fresh.deviceId}`).query({ share: share.body.share_id }).expect(200);
    expect(logs.body.map((log: { message: string }) => log.message)).toEqual(['Shared note']);
  });

  it('refuses a caller without any access', async () => {
    await anonymous().get(`/device/logs/${device.deviceId}`).expect(401);

    const stranger = await createAccount('logs-read-stranger');
    await stranger.client.get(`/device/logs/${device.deviceId}`).expect(403);
  });
});

describe('PUT /device/logs/:device_id/:log_id', () => {
  it('edits an existing entry', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Before' }).expect(200);
    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);

    await owner.client
      .put(`/device/logs/${fresh.deviceId}/${logs.body[0]._id}`)
      .send({ message: 'After', severity: 2, categories: ['diary'] })
      .expect(200);

    const updated = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(updated.body[0]).toMatchObject({ message: 'After', severity: 2 });
  });

  it('validates the payload', async () => {
    const logs = await owner.client.get(`/device/logs/${device.deviceId}`).expect(200);
    const logId = logs.body[0]?._id ?? '60706478aad6c9ad19a31c84';

    await owner.client.put(`/device/logs/${device.deviceId}/${logId}`).send({ severity: 0, categories: ['diary'] }).expect(400);
    await owner.client.put(`/device/logs/${device.deviceId}/${logId}`).send({ message: 'x', categories: ['diary'] }).expect(400);
    await owner.client.put(`/device/logs/${device.deviceId}/${logId}`).send({ message: 'x', severity: 0, categories: [] }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('logs-edit-stranger');
    await stranger.client
      .put(`/device/logs/${device.deviceId}/60706478aad6c9ad19a31c84`)
      .send({ message: 'x', severity: 0, categories: ['diary'] })
      .expect(403);
  });
});

describe('DELETE /device/logs/:device_id/:log_id', () => {
  it('removes a single entry', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Doomed' }).expect(200);
    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);

    await owner.client.delete(`/device/logs/${fresh.deviceId}/${logs.body[0]._id}`).expect(200);

    const remaining = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ deleted: true }).expect(200);
    expect(remaining.body).toHaveLength(0);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('logs-delete-stranger');
    await stranger.client.delete(`/device/logs/${device.deviceId}/60706478aad6c9ad19a31c84`).expect(403);
  });
});

describe('DELETE /device/logs/:device_id', () => {
  it('marks every entry of the device as deleted', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'One' }).expect(200);
    await addEntry(fresh, { message: 'Two' }).expect(200);

    await owner.client.delete(`/device/logs/${fresh.deviceId}`).expect(200);

    const visible = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(visible.body).toHaveLength(0);

    const all = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ deleted: true }).expect(200);
    expect(all.body).toHaveLength(2);
  });

  // The route has no ownership check of its own and the service silently does
  // nothing for a device the caller does not own, so the call still answers 200.
  it('answers 200 but changes nothing for another user´s device', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Kept' }).expect(200);

    const stranger = await createAccount('logs-purge-stranger');
    await stranger.client.delete(`/device/logs/${fresh.deviceId}`).expect(200);

    const visible = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);
    expect(visible.body).toHaveLength(1);
  });

  it('lets an admin delete a single entry of any device', async () => {
    const fresh = await provisionDevice(owner);
    await addEntry(fresh, { message: 'Admin removes this' }).expect(200);
    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).expect(200);

    await admin.client.delete(`/device/logs/${fresh.deviceId}/${logs.body[0]._id}`).expect(200);

    const remaining = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ deleted: true }).expect(200);
    expect(remaining.body).toHaveLength(0);
  });
});
