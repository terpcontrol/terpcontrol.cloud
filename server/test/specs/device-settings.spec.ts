import { anonymous, createAccount, loginAsAdmin, Session, unique } from '../support/api';
import { DeviceCredentials, DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';

let owner: Session;
let admin: Session;
let device: DeviceCredentials;
let simulator: DeviceSimulator;

beforeAll(async () => {
  owner = await createAccount('settings-owner');
  admin = await loginAsAdmin();
  device = await provisionDevice(owner);
  simulator = await startSimulator(device);
  await settle();
});

afterAll(async () => {
  await simulator?.close();
});

describe('POST /device/configure', () => {
  beforeEach(() => simulator.clear());

  it('stores the configuration and pushes it to the device', async () => {
    const configuration = JSON.stringify({ day: { temperature: 26 }, night: { temperature: 20 } });

    await owner.client.post('/device/configure').send({ device_id: device.deviceId, configuration }).expect(200);

    const pushed = await simulator.waitFor('configuration');
    expect(pushed.payload).toBe(configuration);

    // The configuration is a string, and the endpoint returns it JSON-encoded.
    const stored = await owner.client.get(`/device/config/${device.deviceId}`).expect(200);
    expect(stored.body).toBe(configuration);
  });

  it('stores what an admin configures on somebody else´s device', async () => {
    // The guard lets an admin through, and what it lets through has to be
    // written down: a device told to change while the stored configuration
    // stays behind reverts on its next fetch.
    const fresh = await provisionDevice(owner);
    const configuration = JSON.stringify({ day: { temperature: 19 } });

    await admin.client.post('/device/configure').send({ device_id: fresh.deviceId, configuration }).expect(200);

    const stored = await owner.client.get(`/device/config/${fresh.deviceId}`).expect(200);
    expect(stored.body).toBe(configuration);
  });

  it('reports a device that does not exist rather than telling one to change', async () => {
    await owner.client
      .post('/device/configure')
      .send({ device_id: 'no-such-device', configuration: '{}' })
      .expect(403);
  });

  it('writes a diary entry describing what changed', async () => {
    const before = JSON.stringify({ day: { temperature: 26 } });
    const after = JSON.stringify({ day: { temperature: 28 } });

    await owner.client.post('/device/configure').send({ device_id: device.deviceId, configuration: before }).expect(200);
    await owner.client.post('/device/configure').send({ device_id: device.deviceId, configuration: after }).expect(200);

    const logs = await owner.client.get(`/device/logs/${device.deviceId}`).query({ deleted: true }).expect(200);
    const messages = logs.body
      .filter((log: { title: string }) => log.title === 'message-device-configuration-updated')
      .map((log: { message: string }) => log.message);

    expect(messages.some((message: string) => /26/.test(message) && /28/.test(message))).toBe(true);
  });

  it('records that it could not diff against an unparseable previous configuration', async () => {
    const fresh = await provisionDevice(owner);

    await owner.client
      .post('/device/configure')
      .send({ device_id: fresh.deviceId, configuration: JSON.stringify({ day: { temperature: 24 } }) })
      .expect(200);

    const logs = await owner.client.get(`/device/logs/${fresh.deviceId}`).query({ deleted: true }).expect(200);
    const entry = logs.body.find((log: { title: string }) => log.title === 'message-device-configuration-updated');
    expect(entry.message).toMatch(/Could not parse configuration for diff/);
  });

  it('validates that both fields are strings', async () => {
    await owner.client.post('/device/configure').send({ device_id: device.deviceId }).expect(400);
    await owner.client.post('/device/configure').send({ device_id: device.deviceId, configuration: { day: 1 } }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-config-stranger');
    await stranger.client.post('/device/configure').send({ device_id: device.deviceId, configuration: '{}' }).expect(403);
  });

  it('requires a session', async () => {
    await anonymous().post('/device/configure').send({ device_id: device.deviceId, configuration: '{}' }).expect(401);
  });
});

describe('GET /device/config/:device_id', () => {
  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-getconfig-stranger');
    await stranger.client.get(`/device/config/${device.deviceId}`).expect(403);
  });

  it('lets an admin read any device', async () => {
    await admin.client.get(`/device/config/${device.deviceId}`).expect(200);
  });
});

describe('device alarms', () => {
  const alarm = {
    name: 'Too hot',
    sensorType: 'temperature',
    upperThreshold: 30,
    lowerThreshold: null,
    actionType: 'info',
    actionTarget: '',
  };

  it('stores alarms and gives each one an id', async () => {
    await owner.client.post('/device/alarms').send({ device_id: device.deviceId, alarms: [alarm] }).expect(200);

    const response = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ name: 'Too hot', sensorType: 'temperature', upperThreshold: 30 });
    expect(response.body[0].alarmId).toEqual(expect.any(String));
  });

  it('keeps an id that the client supplied', async () => {
    const alarmId = unique('alarm');
    await owner.client
      .post('/device/alarms')
      .send({ device_id: device.deviceId, alarms: [{ ...alarm, alarmId }] })
      .expect(200);

    const response = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);
    expect(response.body[0].alarmId).toBe(alarmId);
  });

  it('replaces the whole list', async () => {
    await owner.client
      .post('/device/alarms')
      .send({ device_id: device.deviceId, alarms: [alarm, { ...alarm, name: 'Second' }] })
      .expect(200);
    await owner.client.post('/device/alarms').send({ device_id: device.deviceId, alarms: [] }).expect(200);

    const response = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);
    expect(response.body).toEqual([]);
  });

  it('refuses a list that is not one, leaving the stored alarms alone', async () => {
    await owner.client.post('/device/alarms').send({ device_id: device.deviceId, alarms: [alarm] }).expect(200);

    await owner.client.post('/device/alarms').send({ device_id: device.deviceId, alarms: 'none' }).expect(400);
    await owner.client.post('/device/alarms').send({ device_id: device.deviceId }).expect(400);

    const response = await owner.client.get(`/device/alarms/${device.deviceId}`).expect(200);
    expect(response.body).toHaveLength(1);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-alarm-stranger');
    await stranger.client.post('/device/alarms').send({ device_id: device.deviceId, alarms: [alarm] }).expect(403);
    await stranger.client.get(`/device/alarms/${device.deviceId}`).expect(403);
  });
});

describe('device cloud settings', () => {
  it('stores settings and fills in the defaults', async () => {
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'stable', betaFeatures: true } })
      .expect(200);

    const response = await owner.client.get(`/device/cloudsettings/${device.deviceId}`).expect(200);

    expect(response.body.cloudSettings).toMatchObject({
      firmwareChannel: 'stable',
      betaFeatures: true,
      vpdLeafTempOffsetDay: -2,
      vpdLeafTempOffsetNight: 0,
      logRtspStreamErrors: true,
      rtspStreamTransport: 'tcp',
    });
    expect(response.body).toMatchObject({ device_id: device.deviceId, device_type: 'fridge', isPublic: false });
  });

  it('rejects settings that are not settings', async () => {
    await owner.client.post('/device/cloudsettings').send({ device_id: device.deviceId, cloud_settings: 'stable' }).expect(400);
    await owner.client.post('/device/cloudsettings').send({ device_id: device.deviceId, cloud_settings: 42 }).expect(400);
  });

  it('rejects an unknown firmware channel', async () => {
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'nightly' } })
      .expect(400);
  });

  it('requires a firmware version on the manual channel', async () => {
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'manual', pendingFirmware: '' } })
      .expect(400);
  });

  it('rejects a firmware that does not belong to the device class', async () => {
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'manual', pendingFirmware: 'no-such-firmware' } })
      .expect(400);
  });

  it('drops an unknown webcam model instead of failing the save', async () => {
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'stable', webcamModel: 'brand-new-cam' } })
      .expect(200);

    const response = await owner.client.get(`/device/cloudsettings/${device.deviceId}`).expect(200);
    expect(response.body.cloudSettings.webcamModel).toBeUndefined();
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-cloud-stranger');
    await stranger.client
      .post('/device/cloudsettings')
      .send({ device_id: device.deviceId, cloud_settings: { firmwareChannel: 'stable' } })
      .expect(403);
    await stranger.client.get(`/device/cloudsettings/${device.deviceId}`).expect(403);
  });
});

describe('POST /device/setname', () => {
  it('renames the device', async () => {
    await owner.client.post('/device/setname').send({ device_id: device.deviceId, name: 'Tent one' }).expect(200);

    const listed = await owner.client.get('/device').expect(200);
    const entry = listed.body.find((candidate: { device_id: string }) => candidate.device_id === device.deviceId);
    expect(entry.name).toBe('Tent one');
  });

  it('validates the payload', async () => {
    await owner.client.post('/device/setname').send({ device_id: device.deviceId }).expect(400);
    await owner.client.post('/device/setname').send({ name: 'No device' }).expect(400);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-name-stranger');
    await stranger.client.post('/device/setname').send({ device_id: device.deviceId, name: 'Mine now' }).expect(403);
  });
});

describe('the recipe of a device', () => {
  const recipe = {
    activeStepIndex: 0,
    activeSince: 0,
    steps: [
      { name: 'Veg', stage: 'vegetative', days: 14 },
      { name: 'Flower', stage: 'flowering', days: 56 },
    ],
  };

  it('starts out empty', async () => {
    const fresh = await provisionDevice(owner);
    const response = await owner.client.get(`/device/recipe/${fresh.deviceId}`).expect(200);
    expect(response.body).toEqual({ steps: [], activeStepIndex: 0, activeSince: 0 });
  });

  it('stores and returns a plan', async () => {
    await owner.client.post('/device/recipe').send({ device_id: device.deviceId, recipe }).expect(200);

    const response = await owner.client.get(`/device/recipe/${device.deviceId}`).expect(200);
    expect(response.body.steps.map((step: { name: string }) => step.name)).toEqual(['Veg', 'Flower']);
  });

  it('rejects a payload without a recipe or a device', async () => {
    await owner.client.post('/device/recipe').send({ device_id: device.deviceId }).expect(400);
    await owner.client.post('/device/recipe').send({ recipe }).expect(400);
  });

  it('rejects a plan whose steps are not a list, leaving the stored one alone', async () => {
    await owner.client.post('/device/recipe').send({ device_id: device.deviceId, recipe }).expect(200);

    await owner.client.post('/device/recipe').send({ device_id: device.deviceId, recipe: { steps: 'Veg' } }).expect(400);
    await owner.client.post('/device/recipe').send({ device_id: device.deviceId, recipe: 'Veg' }).expect(400);

    const response = await owner.client.get(`/device/recipe/${device.deviceId}`).expect(200);
    expect(response.body.steps.map((step: { name: string }) => step.name)).toEqual(['Veg', 'Flower']);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('settings-recipe-stranger');
    await stranger.client.post('/device/recipe').send({ device_id: device.deviceId, recipe }).expect(403);
    await stranger.client.get(`/device/recipe/${device.deviceId}`).expect(403);
  });
});

describe('recipe templates', () => {
  const step = (name: string) => ({ name, settings: { day: { temperature: 26 } }, durationUnit: 'days', duration: 14, waitForConfirmation: false });

  it('creates, reads, updates and deletes a template', async () => {
    const name = unique('template');

    const created = await owner.client
      .post('/device/recipes')
      .send({ name, steps: [step('Veg')], public: false })
      .expect(201);
    expect(created.body).toMatchObject({ name, owner_id: owner.userId, public: false });

    const read = await owner.client.get(`/device/recipes/${created.body._id}`).expect(200);
    expect(read.body.name).toBe(name);

    const renamed = `${name}-v2`;
    const updated = await owner.client.put(`/device/recipes/${created.body._id}`).send({ name: renamed, public: true }).expect(200);
    expect(updated.body).toMatchObject({ name: renamed, public: true });

    await owner.client.delete(`/device/recipes/${created.body._id}`).expect(200);
    await owner.client.get(`/device/recipes/${created.body._id}`).expect(404);
  });

  it('leaves a template alone when the update carries nothing', async () => {
    const name = unique('untouched');
    const created = await owner.client
      .post('/device/recipes')
      .send({ name, steps: [step('Veg')] })
      .expect(201);

    await owner.client.put(`/device/recipes/${created.body._id}`).expect(200);

    const read = await owner.client.get(`/device/recipes/${created.body._id}`).expect(200);
    expect(read.body.name).toBe(name);
    expect(read.body.steps).toHaveLength(1);
  });

  it('rejects a template without a name or steps', async () => {
    await owner.client.post('/device/recipes').send({ name: unique('t') }).expect(400);
    await owner.client.post('/device/recipes').send({ steps: [] }).expect(400);
  });

  it('rejects steps that are not a list', async () => {
    const created = await owner.client
      .post('/device/recipes')
      .send({ name: unique('list'), steps: [step('Veg')] })
      .expect(201);

    await owner.client.post('/device/recipes').send({ name: unique('t'), steps: 'Veg' }).expect(400);
    await owner.client.put(`/device/recipes/${created.body._id}`).send({ steps: 'Veg' }).expect(400);
  });

  // A step that misses a required field fails schema validation, and the error
  // handler has no status to work with, so it surfaces as a 500 rather than a 400.
  it('answers 500 for a step that does not satisfy the schema', async () => {
    await owner.client
      .post('/device/recipes')
      .send({ name: unique('bad-step'), steps: [{ name: 'Veg', days: 14 }] })
      .expect(500);
  });

  it('rejects a duplicate template name', async () => {
    const name = unique('template');
    await owner.client.post('/device/recipes').send({ name, steps: [] }).expect(201);
    await owner.client.post('/device/recipes').send({ name, steps: [] }).expect(409);
  });

  it('lists public templates and the caller´s own', async () => {
    const stranger = await createAccount('settings-template-stranger');
    const publicName = unique('public-template');
    const privateName = unique('private-template');

    await stranger.client.post('/device/recipes').send({ name: publicName, steps: [], public: true }).expect(201);
    await stranger.client.post('/device/recipes').send({ name: privateName, steps: [], public: false }).expect(201);

    const response = await owner.client.get('/device/recipes').expect(200);
    const names = response.body.map((template: { name: string }) => template.name);

    expect(names).toContain(publicName);
    expect(names).not.toContain(privateName);
  });

  it('hides a private template from other users', async () => {
    const stranger = await createAccount('settings-template-reader');
    const created = await owner.client.post('/device/recipes').send({ name: unique('secret'), steps: [] }).expect(201);

    await stranger.client.get(`/device/recipes/${created.body._id}`).expect(403);
    await stranger.client.put(`/device/recipes/${created.body._id}`).send({ name: unique('stolen') }).expect(403);
    await stranger.client.delete(`/device/recipes/${created.body._id}`).expect(403);
  });

  it('lets an admin reach any template', async () => {
    const created = await owner.client.post('/device/recipes').send({ name: unique('admin-visible'), steps: [] }).expect(201);
    await admin.client.get(`/device/recipes/${created.body._id}`).expect(200);
  });

  it('reports an unknown template as not found', async () => {
    await owner.client.get('/device/recipes/60706478aad6c9ad19a31c84').expect(404);
  });

  it('rejects an id that is not one', async () => {
    await owner.client.get('/device/recipes/not-an-id').expect(400);
    await owner.client.put('/device/recipes/not-an-id').send({ name: unique('x') }).expect(400);
    await owner.client.delete('/device/recipes/not-an-id').expect(400);
  });
});
