import { anonymous, createAccount, Session } from '../support/api';
import { DeviceCredentials, provisionDevice } from '../support/device';

let owner: Session;
let device: DeviceCredentials;

beforeAll(async () => {
  owner = await createAccount('share-owner');
  device = await provisionDevice(owner);
});

const createShare = (overrides: Record<string, unknown> = {}) =>
  owner.client.post('/share').send({ device_id: device.deviceId, page: 'charts', ...overrides });

describe('POST /share', () => {
  it('creates a link for a device the caller owns', async () => {
    const response = await createShare().expect(201);

    expect(response.body).toMatchObject({
      share_id: expect.any(String),
      device_id: device.deviceId,
      owner_id: owner.userId,
      page: 'charts',
      editable: false,
      webcam: false,
      charts: false,
      expiresAt: null,
    });
  });

  it('always includes the webcam in an editable link', async () => {
    const response = await createShare({ editable: true, webcam: false }).expect(201);
    expect(response.body.webcam).toBe(true);
  });

  it('only carries chart access on a diary link', async () => {
    const diary = await createShare({ page: 'diary', charts: true }).expect(201);
    expect(diary.body.charts).toBe(true);

    const charts = await createShare({ page: 'charts', charts: true }).expect(201);
    expect(charts.body.charts).toBe(false);
  });

  it('stores an expiry in the future', async () => {
    const expiresAt = Date.now() + 3_600_000;
    const response = await createShare({ expires_at: expiresAt }).expect(201);
    expect(response.body.expiresAt).toBe(expiresAt);
  });

  it('truncates an over-long saved query', async () => {
    const response = await createShare({ query: 'x'.repeat(2500) }).expect(201);
    expect(response.body.query).toHaveLength(2000);
  });

  it('rejects an expiry in the past', async () => {
    await createShare({ expires_at: Date.now() - 1000 }).expect(400);
  });

  it('rejects an unknown page', async () => {
    await createShare({ page: 'dashboard' }).expect(400);
  });

  it('rejects a missing device id', async () => {
    await owner.client.post('/share').send({ page: 'charts' }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('share-stranger');
    await stranger.client.post('/share').send({ device_id: device.deviceId, page: 'charts' }).expect(403);
  });

  it('requires a session', async () => {
    await anonymous().post('/share').send({ device_id: device.deviceId, page: 'charts' }).expect(401);
  });
});

describe('GET /share/resolve/:share_id', () => {
  it('resolves without a session and counts the visit', async () => {
    const created = await createShare({ page: 'diary' }).expect(201);

    const resolved = await anonymous().get(`/share/resolve/${created.body.share_id}`).expect(200);

    expect(resolved.body).toMatchObject({
      device_id: device.deviceId,
      device_type: device.deviceType,
      isPublic: true,
      share: { share_id: created.body.share_id, page: 'diary', editable: false },
    });

    const listed = await owner.client.get('/share').expect(200);
    const entry = listed.body.find((share: { share_id: string }) => share.share_id === created.body.share_id);
    expect(entry.openCount).toBe(1);
    expect(entry.lastOpenedAt).toEqual(expect.any(Number));
  });

  it('hides the webcam stream unless the link grants it', async () => {
    const withoutWebcam = await createShare().expect(201);
    const resolved = await anonymous().get(`/share/resolve/${withoutWebcam.body.share_id}`).expect(200);
    expect(resolved.body.cloudSettings.rtspStream).toBeUndefined();
  });

  it('reports an unknown link as not found', async () => {
    await anonymous().get('/share/resolve/not-a-real-share').expect(404);
  });

  it('refuses a revoked link', async () => {
    const created = await createShare().expect(201);
    await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(200);

    await anonymous().get(`/share/resolve/${created.body.share_id}`).expect(404);
  });

  it('refuses an expired link', async () => {
    const created = await createShare({ expires_at: Date.now() + 1200 }).expect(201);
    await anonymous().get(`/share/resolve/${created.body.share_id}`).expect(200);

    await new Promise(resolve => setTimeout(resolve, 1400));
    await anonymous().get(`/share/resolve/${created.body.share_id}`).expect(404);
  });
});

describe('GET /share', () => {
  it('lists only the caller´s links', async () => {
    const lister = await createAccount('share-lister');
    const listerDevice = await provisionDevice(lister);
    await lister.client.post('/share').send({ device_id: listerDevice.deviceId, page: 'charts' }).expect(201);

    const response = await lister.client.get('/share').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].device_id).toBe(listerDevice.deviceId);
  });

  it('requires a session', async () => {
    await anonymous().get('/share').expect(401);
  });
});

describe('POST /share/:share_id/revoke', () => {
  it('revokes an active link', async () => {
    const created = await createShare().expect(201);

    const response = await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(200);
    expect(response.body.revokedAt).toEqual(expect.any(Number));
  });

  it('reports a second revoke as not found', async () => {
    const created = await createShare().expect(201);
    await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(200);
    await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(404);
  });

  it('will not revoke somebody else´s link', async () => {
    const stranger = await createAccount('share-revoker');
    const created = await createShare().expect(201);

    await stranger.client.post(`/share/${created.body.share_id}/revoke`).expect(404);
  });
});

describe('DELETE /share/:share_id', () => {
  it('refuses to delete a link that is still active', async () => {
    const created = await createShare().expect(201);
    await owner.client.delete(`/share/${created.body.share_id}`).expect(404);
  });

  it('deletes a revoked link', async () => {
    const created = await createShare().expect(201);
    await owner.client.post(`/share/${created.body.share_id}/revoke`).expect(200);

    await owner.client.delete(`/share/${created.body.share_id}`).expect(200);

    const listed = await owner.client.get('/share').expect(200);
    expect(listed.body.find((share: { share_id: string }) => share.share_id === created.body.share_id)).toBeUndefined();
  });
});

describe('DELETE /share/inactive', () => {
  it('deletes every revoked or expired link and leaves active ones', async () => {
    const cleaner = await createAccount('share-cleaner');
    const cleanerDevice = await provisionDevice(cleaner);
    const create = (body: Record<string, unknown>) =>
      cleaner.client.post('/share').send({ device_id: cleanerDevice.deviceId, page: 'charts', ...body });

    const active = await create({}).expect(201);
    const revoked = await create({}).expect(201);
    await cleaner.client.post(`/share/${revoked.body.share_id}/revoke`).expect(200);
    const expiring = await create({ expires_at: Date.now() + 1200 }).expect(201);
    await new Promise(resolve => setTimeout(resolve, 1400));

    const response = await cleaner.client.delete('/share/inactive').expect(200);
    expect(response.body.deleted).toBe(2);

    const remaining = await cleaner.client.get('/share').expect(200);
    expect(remaining.body.map((share: { share_id: string }) => share.share_id)).toEqual([active.body.share_id]);
    expect(remaining.body.map((share: { share_id: string }) => share.share_id)).not.toContain(expiring.body.share_id);
  });
});
