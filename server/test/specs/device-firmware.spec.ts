import { anonymous, createAccount, loginAsAdmin, Session, unique } from '../support/api';
import { DeviceCredentials, provisionDevice } from '../support/device';

let owner: Session;
let admin: Session;
let device: DeviceCredentials;

const createFirmware = (version = unique('v')) => admin.client.post('/device/firmware').send({ name: 'fridge', version });

beforeAll(async () => {
  owner = await createAccount('firmware-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
});

describe('POST /device/firmware', () => {
  it('creates a firmware record for a device class', async () => {
    const version = unique('v');
    const response = await createFirmware(version).expect(200);

    expect(response.body).toEqual({ firmware_id: expect.any(String), name: 'fridge', version });
  });

  it('accepts the multipart form the webapp sends, image and all', async () => {
    const version = unique('v');

    const response = await admin.client
      .post('/device/firmware')
      .field('name', 'fridge')
      .field('version', version)
      .attach('file', Buffer.from('an image the webapp attaches'), 'firmware.bin')
      .expect(200);

    expect(response.body).toEqual({ firmware_id: expect.any(String), name: 'fridge', version });
  });

  it('reports an unknown device class as not found', async () => {
    await admin.client.post('/device/firmware').send({ name: 'no-such-class', version: '1.0' }).expect(404);
  });

  it('validates the payload', async () => {
    await admin.client.post('/device/firmware').send({ name: 'fridge' }).expect(400);
    await admin.client.post('/device/firmware').send({ version: '1.0' }).expect(400);
  });

  it('is admin-only', async () => {
    await owner.client.post('/device/firmware').send({ name: 'fridge', version: '1.0' }).expect(401);
    await anonymous().post('/device/firmware').send({ name: 'fridge', version: '1.0' }).expect(401);
  });
});

describe('firmware binaries', () => {
  it('stores a binary and serves it back without a session', async () => {
    const created = await createFirmware().expect(200);
    const payload = Buffer.from('a firmware image');

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', payload, 'firmware.bin')
      .expect(200);

    // The device fetches this over plain HTTP, with no credentials of its own.
    const download = await anonymous().get(`/device/firmware/${created.body.firmware_id}/firmware.bin`).expect(200);

    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toBe('attachment; filename=firmware.bin');
    expect(Buffer.from(download.body)).toEqual(payload);
  });

  it('serves a binary under the legacy firmware path too', async () => {
    const created = await createFirmware().expect(200);
    const payload = Buffer.from('legacy path image');

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', payload, 'firmware.bin')
      .expect(200);

    const download = await anonymous().get(`/auth/v0.0.1/device/firmware/${created.body.firmware_id}/firmware.bin`).expect(200);
    expect(Buffer.from(download.body)).toEqual(payload);
  });

  it('replaces a binary of the same name', async () => {
    const created = await createFirmware().expect(200);

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', Buffer.from('first'), 'firmware.bin')
      .expect(200);
    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', Buffer.from('second'), 'firmware.bin')
      .expect(200);

    const download = await anonymous().get(`/device/firmware/${created.body.firmware_id}/firmware.bin`).expect(200);
    expect(download.body.toString()).toBe('second');
  });

  it('keeps several named binaries side by side', async () => {
    const created = await createFirmware().expect(200);

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', Buffer.from('app'), 'firmware.bin')
      .expect(200);
    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/spiffs.bin`)
      .attach('binary', Buffer.from('filesystem'), 'spiffs.bin')
      .expect(200);

    const app = await anonymous().get(`/device/firmware/${created.body.firmware_id}/firmware.bin`).expect(200);
    const filesystem = await anonymous().get(`/device/firmware/${created.body.firmware_id}/spiffs.bin`).expect(200);

    expect(app.body.toString()).toBe('app');
    expect(filesystem.body.toString()).toBe('filesystem');
  });

  it('refuses an OTA image larger than the partition', async () => {
    const created = await createFirmware().expect(200);
    const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1, 0x41);

    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', tooBig, 'firmware.bin')
      .expect(413);
  });

  it('does not apply the OTA size limit to other binaries', async () => {
    const created = await createFirmware().expect(200);
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x42);

    await admin.client.post(`/device/firmware/${created.body.firmware_id}/spiffs.bin`).attach('binary', big, 'spiffs.bin').expect(200);
  });

  it('is admin-only to upload', async () => {
    const created = await createFirmware().expect(200);
    await owner.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', Buffer.from('nope'), 'firmware.bin')
      .expect(401);
  });
});

describe('GET /device/firmware', () => {
  it('lists every firmware for an admin', async () => {
    const created = await createFirmware().expect(200);

    const response = await admin.client.get('/device/firmware').expect(200);

    expect(response.body.some((firmware: { firmware_id: string }) => firmware.firmware_id === created.body.firmware_id)).toBe(true);
    for (const firmware of response.body) {
      expect(firmware).toEqual({ firmware_id: expect.any(String), name: expect.any(String), version: expect.any(String) });
    }
  });

  it('is admin-only', async () => {
    await owner.client.get('/device/firmware').expect(401);
  });
});

describe('GET /device/firmware/find', () => {
  it('finds a firmware by class name and version', async () => {
    const version = unique('v');
    const created = await createFirmware(version).expect(200);

    const response = await admin.client.get('/device/firmware/find').query({ name: 'fridge', version }).expect(200);

    expect(response.body.firmware_id).toBe(created.body.firmware_id);
  });

  it('reports an unknown combination as not found', async () => {
    await admin.client.get('/device/firmware/find').query({ name: 'fridge', version: 'never-built' }).expect(404);
  });

  it('is admin-only', async () => {
    await owner.client.get('/device/firmware/find').query({ name: 'fridge', version: '1.0' }).expect(401);
  });
});

describe('PUT /device/firmware/:firmware_id', () => {
  it('relabels a firmware', async () => {
    const created = await createFirmware().expect(200);
    const version = unique('renamed');

    const response = await admin.client.put(`/device/firmware/${created.body.firmware_id}`).send({ version }).expect(200);

    expect(response.body).toEqual({ firmware_id: created.body.firmware_id, name: 'fridge', version });
  });

  it('rejects a missing or blank version', async () => {
    const created = await createFirmware().expect(200);
    await admin.client.put(`/device/firmware/${created.body.firmware_id}`).send({}).expect(400);
    await admin.client.put(`/device/firmware/${created.body.firmware_id}`).send({ version: '   ' }).expect(400);
  });

  it('reports an unknown firmware as not found', async () => {
    await admin.client.put('/device/firmware/no-such-firmware').send({ version: '1.0' }).expect(404);
  });

  it('is admin-only', async () => {
    const created = await createFirmware().expect(200);
    await owner.client.put(`/device/firmware/${created.body.firmware_id}`).send({ version: '1.0' }).expect(401);
  });
});

describe('DELETE /device/firmware/:firmware_id', () => {
  it('removes the firmware and its binaries', async () => {
    const created = await createFirmware().expect(200);
    await admin.client
      .post(`/device/firmware/${created.body.firmware_id}/firmware.bin`)
      .attach('binary', Buffer.from('bytes'), 'firmware.bin')
      .expect(200);

    await admin.client.delete(`/device/firmware/${created.body.firmware_id}`).expect(200);

    const listed = await admin.client.get('/device/firmware').expect(200);
    expect(listed.body.some((firmware: { firmware_id: string }) => firmware.firmware_id === created.body.firmware_id)).toBe(false);
  });

  it('is admin-only', async () => {
    const created = await createFirmware().expect(200);
    await owner.client.delete(`/device/firmware/${created.body.firmware_id}`).expect(401);
  });
});

describe('GET /device/firmwares/:device_id', () => {
  it('lists the firmwares available for the caller´s device', async () => {
    const version = unique('v');
    await createFirmware(version).expect(200);

    const response = await owner.client.get(`/device/firmwares/${device.deviceId}`).expect(200);

    expect(response.body.firmwares.some((firmware: { version: string }) => firmware.version === version)).toBe(true);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('firmware-stranger');
    await stranger.client.get(`/device/firmwares/${device.deviceId}`).expect(403);
  });

  it('requires a session', async () => {
    await anonymous().get(`/device/firmwares/${device.deviceId}`).expect(401);
  });
});

describe('device classes', () => {
  it('lists the classes that are created on first start', async () => {
    const response = await admin.client.get('/device/class').expect(200);

    const names = response.body.map((deviceClass: { name: string }) => deviceClass.name);
    expect(names).toEqual(expect.arrayContaining(['fridge', 'controller', 'plug', 'fan', 'light']));
  });

  it('finds a class by name and reads it back by id', async () => {
    const found = await admin.client.get('/device/class/find/fridge').expect(200);
    expect(found.body.name).toBe('fridge');

    const read = await admin.client.get(`/device/class/${found.body.class_id}`).expect(200);
    expect(read.body.class_id).toBe(found.body.class_id);
  });

  it('reports an unknown class name as not found', async () => {
    await admin.client.get('/device/class/find/no-such-class').expect(404);
  });

  it('creates and updates a class', async () => {
    const name = unique('class');

    await admin.client
      .post('/device/class')
      .send({ name, description: 'A test class', firmware_id: '', concurrent: 5, maxfails: 10 })
      .expect(200);

    const created = await admin.client.get(`/device/class/find/${name}`).expect(200);
    expect(created.body).toMatchObject({ name, description: 'A test class', concurrent: 5, maxfails: 10 });

    await admin.client
      .post(`/device/class/${created.body.class_id}`)
      .send({ name, description: 'An updated class', firmware_id: '', concurrent: 7, maxfails: 3 })
      .expect(200);

    const updated = await admin.client.get(`/device/class/${created.body.class_id}`).expect(200);
    expect(updated.body).toMatchObject({ description: 'An updated class', concurrent: 7, maxfails: 3 });
  });

  it('validates the class payload', async () => {
    await admin.client.post('/device/class').send({ name: unique('class'), description: 'x' }).expect(400);
    await admin.client
      .post('/device/class')
      .send({ name: unique('class'), description: 'x', firmware_id: '', concurrent: 'many', maxfails: 1 })
      .expect(400);
  });

  it('is admin-only', async () => {
    await owner.client.get('/device/class').expect(401);
    await owner.client.get('/device/class/find/fridge').expect(401);
    await owner.client.post('/device/class').send({ name: 'x', description: 'y', firmware_id: '', concurrent: 1, maxfails: 1 }).expect(401);
  });
});
