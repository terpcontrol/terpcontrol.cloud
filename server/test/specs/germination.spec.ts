import { createAccount, Session } from '../support/api';
import { DeviceCredentials, DeviceType, provisionDevice } from '../support/device';

/**
 * Germination over HTTP: the one meaning the stage has wherever it is chosen -
 * a climate preset, a grow's phase, the targets saved for it - for a fridge and
 * a tent controller alike. Germination is dark: the firmware's `breed` mode,
 * holding one temperature round the clock without light or CO2. Every other
 * stage brings the device back to its standard mode.
 */

const HOUR = 3600;

let owner: Session;

const document = (over: Record<string, unknown> = {}) => ({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 20, humidity: 55 },
  co2: { target: 900 },
  daynight: { day: 6 * HOUR, night: 22 * HOUR },
  lights: { limit: 80, sunrise: 15, sunset: 15 },
  ...over,
});

const configurationOf = async (device: DeviceCredentials) =>
  (await owner.client.get(`/v1/devices/${device.deviceId}/configuration`).expect(200)).body.configuration;

const controlOf = async (device: DeviceCredentials) => (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.control;

/** A device claimed into a place of its own, with a document of its own. */
const placed = async (type: DeviceType): Promise<{ device: DeviceCredentials; spaceId: string }> => {
  const device = await provisionDevice(owner, type);
  await owner.client.put(`/v1/devices/${device.deviceId}/configuration`).send({ configuration: document() }).expect(200);
  return { device, spaceId: (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId };
};

const growIn = async (spaceId: string): Promise<string> =>
  (
    await owner.client
      .post('/v1/grows')
      .send({ name: 'Seeds', type: 'photoperiod', plants: [{ strain: 'Gelato', count: 3 }], spaceId })
      .expect(201)
  ).body.id;

beforeAll(async () => {
  owner = await createAccount('germination-owner');
});

describe('the germination preset', () => {
  it.each<DeviceType>(['fridge', 'controller'])(
    'darkens a %s at the germination temperature, and leaves the rest of its climate for the seedling',
    async type => {
      const { device, spaceId } = await placed(type);

      await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'germination' }).expect(201);

      expect(await configurationOf(device)).toMatchObject({
        workmode: 'breed',
        night: { temperature: 24, humidity: 55 },
        day: { temperature: 25, humidity: 60 },
        lights: { limit: 80 },
        daynight: { day: 6 * HOUR, night: 22 * HOUR },
      });
      expect(await controlOf(device)).toMatchObject({ running: true, mode: 'germination', afterGermination: { nightTemperature: 20 } });

      await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'seedling' }).expect(201);

      expect(await configurationOf(device)).toMatchObject({
        workmode: 'small',
        day: { temperature: 24, humidity: 70 },
        night: { temperature: 21, humidity: 65 },
        lights: { limit: 40 },
      });
      expect(await controlOf(device)).toMatchObject({ mode: 'standard' });
    },
  );

  it('brings a fridge back onto its energy saving when germination ends', async () => {
    const { device, spaceId } = await placed('fridge');
    await owner.client
      .patch(`/v1/devices/${device.deviceId}/configuration`)
      .send({ set: { energySaving: true } })
      .expect(200);

    await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'germination' }).expect(201);
    expect((await configurationOf(device)).workmode).toBe('breed');

    await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(201);
    expect((await configurationOf(device)).workmode).toBe('full');
    expect(await controlOf(device)).toMatchObject({ mode: 'standard', energySaving: true });
  });

  it('watches the temperature it holds and no humidity, which it does not hold', async () => {
    const { device, spaceId } = await placed('controller');
    await growIn(spaceId);

    await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'germination' }).expect(201);

    const rules = (await owner.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200)).body.items.filter(
      (rule: { origin: string }) => rule.origin === 'preset',
    );
    const watched = Object.fromEntries(rules.map((rule: { name: string; watch: unknown }) => [rule.name, rule.watch]));
    expect(Object.keys(watched).sort()).toEqual(['CO₂ too high', 'Too cold', 'Too hot']);
    expect(watched['Too hot']).toMatchObject({ metric: 'temperature', upper: 29 });
    expect(watched['Too cold']).toMatchObject({ metric: 'temperature', lower: 20 });
  });
});

describe('a grow entering germination', () => {
  it('darkens the place where its climate is asked for, and the next stage brings the light back with the night from before', async () => {
    const { device, spaceId } = await placed('fridge');
    const grow = await growIn(spaceId);

    await owner.client.post(`/v1/grows/${grow}/phases`).send({ stage: 'germination', climate: true }).expect(201);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'breed', night: { temperature: 24 } });

    // The seedling stage without its climate: the light comes back on the targets that held before germination.
    await owner.client.post(`/v1/grows/${grow}/phases`).send({ stage: 'seedling' }).expect(201);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'small', day: { temperature: 25 }, night: { temperature: 20 } });
    expect((await controlOf(device)).afterGermination).toBeUndefined();
  });

  it('darkens nothing where only the phase is written', async () => {
    const { device, spaceId } = await placed('controller');
    const grow = await growIn(spaceId);

    await owner.client.post(`/v1/grows/${grow}/phases`).send({ stage: 'germination' }).expect(201);

    expect(await configurationOf(device)).toMatchObject({ workmode: 'small', night: { temperature: 20 } });
    const read = (await owner.client.get(`/v1/grows/${grow}`).expect(200)).body;
    expect(read.summary.stage).toBe('germination');
  });
});

describe('the targets saved for germination', () => {
  it('germinate in the dark, and come back to the standard mode when saved for anything else', async () => {
    const { device } = await placed('controller');

    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({ configuration: document({ night: { temperature: 24, humidity: 55 } }), germination: true })
      .expect(200);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'breed', night: { temperature: 24 } });

    // Saved without saying, it goes on germinating.
    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({ configuration: document({ night: { temperature: 23, humidity: 55 } }) })
      .expect(200);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'breed', night: { temperature: 23 } });

    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({ configuration: document({ night: { temperature: 21, humidity: 65 } }), germination: false, drying: false })
      .expect(200);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'small', night: { temperature: 21 } });
  });
});

describe('the operating mode of a tent controller', () => {
  it('offers germination in the dark beside the standard, and not the greenhouse mode', async () => {
    const { device } = await placed('controller');

    const answer = await owner.client
      .patch(`/v1/devices/${device.deviceId}/configuration`)
      .send({ set: { mode: 'germination' } })
      .expect(200);
    expect(answer.body.control).toMatchObject({ running: true, mode: 'germination' });

    const refused = await owner.client
      .patch(`/v1/devices/${device.deviceId}/configuration`)
      .send({ set: { mode: 'greenhouse' } })
      .expect(422);
    expect(refused.body.errors).toEqual([expect.objectContaining({ field: 'set.mode', code: 'out_of_range' })]);

    await owner.client
      .patch(`/v1/devices/${device.deviceId}/configuration`)
      .send({ set: { mode: 'standard' } })
      .expect(200);
    expect(await configurationOf(device)).toMatchObject({ workmode: 'small', night: { temperature: 20 } });
  });
});
