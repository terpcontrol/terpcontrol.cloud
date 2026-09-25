import { anonymous, createAccount, Session } from '../support/api';
import { claimCodeOf, DeviceSimulator, provisionDevice, registerDevice, settle, startSimulator } from '../support/device';

/**
 * A device from the moment it enrols to the moment somebody gives it up: who it
 * belongs to, where it stands, and what reaches the hardware.
 *
 * The two halves meet here. Enrolling and the claim code are the frozen device
 * protocol, in the device's own snake_case; everything a person does with the
 * device afterwards is `/v1`.
 */

let owner: Session;

beforeAll(async () => {
  owner = await createAccount('devices-owner');
});

describe('claiming a device', () => {
  it('gives it an owner and a place to stand, and says the place is new', async () => {
    const device = await registerDevice();

    const claimed = await owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(device.deviceId) })
      .expect(201);

    expect(claimed.body.spaceCreated).toBe(true);
    expect(claimed.body.device).toMatchObject({ id: device.deviceId, ownerId: owner.userId, type: 'fridge' });
    expect(claimed.body.device.spaceId).toEqual(expect.any(String));
    expect(claimed.body.device.state.claimedAt).toEqual(expect.any(String));

    // The place is not called after the hardware: a space named "fridge" is
    // what a grower would read on their first home card, in every language.
    const place = (await owner.client.get(`/v1/spaces/${claimed.body.device.spaceId}`).expect(200)).body;
    expect(place.name).not.toBe('fridge');
    expect(place.name).toBe(device.deviceId.slice(-6).toUpperCase());
  });

  it('takes the name the claim gives the place instead of inventing one', async () => {
    const device = await registerDevice('controller');

    const claimed = await owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(device.deviceId), name: 'Tent 1' })
      .expect(201);

    const place = (await owner.client.get(`/v1/spaces/${claimed.body.device.spaceId}`).expect(200)).body;
    expect(place).toMatchObject({ name: 'Tent 1', kind: 'tent' });
  });

  it('tells the owner of a device that they already added it', async () => {
    const device = await provisionDevice(owner);

    const refused = await owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(device.deviceId) })
      .expect(409);

    expect(refused.body.code).toBe('device_already_yours');
    expect(refused.body.detail).toMatch(/already added this device/);
  });

  it('puts it into a space that was named instead of making a second one', async () => {
    const first = await registerDevice();
    const made = await owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(first.deviceId) })
      .expect(201);

    const second = await registerDevice('controller');
    const joined = await owner.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(second.deviceId), spaceId: made.body.device.spaceId })
      .expect(201);

    expect(joined.body.spaceCreated).toBe(false);
    expect(joined.body.device.spaceId).toBe(made.body.device.spaceId);
  });

  it('spends the code, so the same one cannot be used twice', async () => {
    const device = await registerDevice();
    const code = await claimCodeOf(device.deviceId);

    await owner.client.post('/v1/devices/claims').send({ code }).expect(201);

    const again = await createAccount('devices-latecomer');
    const refused = await again.client.post('/v1/devices/claims').send({ code }).expect(404);
    expect(refused.body.code).toBe('claim_code_unknown');
  });

  it('refuses a device somebody already owns, even with a fresh code', async () => {
    const device = await provisionDevice(owner);
    const stranger = await createAccount('devices-stranger');

    const refused = await stranger.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(device.deviceId) })
      .expect(409);

    expect(refused.body.code).toBe('device_claimed');
  });

  it('will not put a device into somebody else´s space', async () => {
    const mine = await provisionDevice(owner);
    const space = (await owner.client.get(`/v1/devices/${mine.deviceId}`).expect(200)).body.spaceId;

    const stranger = await createAccount('devices-space-stranger');
    const theirs = await registerDevice();

    await stranger.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(theirs.deviceId), spaceId: space })
      .expect(404);
  });
});

describe('giving a device up', () => {
  it('leaves it claimable, and keeps nothing the previous owner decided about it', async () => {
    const device = await provisionDevice(owner);
    await owner.client.post(`/v1/devices/${device.deviceId}/alarm-rules`).send(aRule()).expect(201);

    await owner.client.delete(`/v1/devices/${device.deviceId}/claim`).expect(204);

    // Gone from the owner's listing, and nobody's again.
    const listed = await owner.client.get('/v1/devices').expect(200);
    expect(listed.body.items.some((entry: { id: string }) => entry.id === device.deviceId)).toBe(false);

    const next = await createAccount('devices-next-owner');
    const claimed = await next.client
      .post('/v1/devices/claims')
      .send({ code: await claimCodeOf(device.deviceId) })
      .expect(201);
    expect(claimed.body.device.ownerId).toBe(next.userId);

    // The rules the first owner wrote did not come with it.
    const rules = await next.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200);
    expect(rules.body.items).toEqual([]);
  });
});

describe('what a stranger and a device´s owner may do', () => {
  it('hides a device from everyone but the people it belongs to', async () => {
    const device = await provisionDevice(owner);
    const stranger = await createAccount('devices-outsider');

    await stranger.client.get(`/v1/devices/${device.deviceId}`).expect(404);
    await stranger.client.post(`/v1/devices/${device.deviceId}/commands`).send({ kind: 'reboot' }).expect(404);
    await anonymous().get(`/v1/devices/${device.deviceId}`).expect(401);
  });
});

describe('what reaches the hardware', () => {
  let device: Awaited<ReturnType<typeof provisionDevice>>;
  let simulator: DeviceSimulator;

  beforeAll(async () => {
    device = await provisionDevice(owner);
    simulator = await startSimulator(device);
    await settle();
  });

  afterAll(async () => {
    await simulator?.close();
  });

  it('sends the configuration a client wrote, and hands the same document back', async () => {
    const configuration = { day: { temperature: 24 }, night: { temperature: 20 } };
    simulator.clear();

    await owner.client.put(`/v1/devices/${device.deviceId}/configuration`).send({ configuration }).expect(200);

    const sent = await simulator.waitFor('configuration');
    expect(JSON.parse(sent.payload)).toEqual(configuration);

    const read = await owner.client.get(`/v1/devices/${device.deviceId}/configuration`).expect(200);
    expect(read.body.configuration).toEqual(configuration);
  });

  it('says of a device that never reported its configuration that it has none, on both routes alike', async () => {
    const silent = await provisionDevice(owner, 'controller');

    const whole = await owner.client.get(`/v1/devices/${silent.deviceId}`).expect(200);
    expect(whole.body.configuration).toBeNull();

    // Not an empty document, which reads as settings that are empty.
    const read = await owner.client.get(`/v1/devices/${silent.deviceId}/configuration`).expect(200);
    expect(read.body).toEqual({ configuration: null });
  });

  it('translates a command into the words the firmware understands', async () => {
    simulator.clear();

    const published = await owner.client.post(`/v1/devices/${device.deviceId}/commands`).send({ kind: 'maintenance', forSeconds: 300 }).expect(202);
    expect(published.body).toMatchObject({ publishedAt: expect.any(String), deviceOnline: expect.any(Boolean) });

    // The device counts in whole minutes, which is what the protocol module turns
    // the contract's seconds into.
    const sent = await simulator.waitFor('command');
    expect(JSON.parse(sent.payload)).toEqual({ action: 'maintenance', durationMinutes: 5 });
  });

  it('refuses the firmware bench test, which the contract does not offer', async () => {
    await owner.client
      .post(`/v1/devices/${device.deviceId}/commands`)
      .send({ kind: 'test', outputs: { heater: 100 } })
      .expect(400);
    await owner.client.post(`/v1/devices/${device.deviceId}/commands`).send({ kind: 'stop_test' }).expect(400);
  });

  it('answers what the device measured, with the age of every reading', async () => {
    await simulator.reportStatus({ temperature: 21.5, humidity: 55 });
    await settle(1000);

    const live = await owner.client.get(`/v1/devices/${device.deviceId}/live`).expect(200);

    expect(live.body.metrics.temperature).toMatchObject({ value: 21.5, state: 'live' });
    expect(live.body.metrics.humidity).toMatchObject({ value: 55 });
  });

  /**
   * The light output runs at a level rather than on or off, and the level is a
   * series: no read answers an output's newest value on its own, so a screen
   * that draws a dimmer asks for the shortest series there is - and has no
   * reading to ask for beside it.
   */
  it('answers a series asked for an output alone, with no metric named at all', async () => {
    await simulator.reportStatus({ temperature: 21.5 }, { light: 40 });
    await settle(1000);

    const series = await owner.client
      .get(`/v1/devices/${device.deviceId}/series`)
      .query({ startsAt: new Date(Date.now() - 900_000).toISOString(), endsAt: new Date().toISOString(), stepSeconds: 30 })
      .query('outputs=light')
      .expect(200);

    expect(series.body.metrics).toEqual([]);
    expect(series.body.outputs).toHaveLength(1);
    expect(series.body.outputs[0].output).toBe('light');
    expect(series.body.outputs[0].points.filter((point: { value: number | null }) => point.value !== null)).toContainEqual(
      expect.objectContaining({ value: 40 }),
    );
  });
});

const aRule = () => ({
  name: 'Too hot',
  watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
  forSeconds: 60,
  severity: 'warning',
  enabled: true,
  cooldownSeconds: 600,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
});
