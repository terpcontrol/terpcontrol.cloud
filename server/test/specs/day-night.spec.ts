import { createAccount, Session } from '../support/api';
import { DeviceCredentials, DeviceSimulator, provisionDevice, settle, startSimulator, utcSecondsOf } from '../support/device';

/**
 * Day and night over HTTP and MQTT: what a fridge and a controller are sent
 * for a light window, which figures a mode leaves alone, and which half the
 * live answer says holds - by the device's clock window and work mode, never by
 * its lamp.
 */

const HOUR = 3600;
const MINUTES = 60_000;

let owner: Session;

const fridgeDocument = (over: Record<string, unknown> = {}) => ({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 21, humidity: 55 },
  co2: { target: 900 },
  daynight: { day: 6 * HOUR, night: 18 * HOUR },
  lights: { limit: 80, sunrise: 15, sunset: 15 },
  ...over,
});

const write = async (device: DeviceCredentials, configuration: Record<string, unknown>, drying?: boolean) =>
  (
    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({ configuration, ...(drying === undefined ? {} : { drying }) })
      .expect(200)
  ).body.configuration;

const live = async (device: DeviceCredentials) => (await owner.client.get(`/v1/devices/${device.deviceId}/live`).expect(200)).body;

beforeAll(async () => {
  owner = await createAccount('day-night-owner');
});

describe('a light window written with the targets', () => {
  it('goes off a second before midnight UTC rather than on it, and answers what was stored', async () => {
    const fridge = await provisionDevice(owner, 'fridge');

    const stored = await write(fridge, fridgeDocument({ daynight: { day: 6 * HOUR, night: 0 } }));

    expect(stored.daynight).toMatchObject({ day: 6 * HOUR, night: 86_399 });
    const read = (await owner.client.get(`/v1/devices/${fridge.deviceId}/configuration`).expect(200)).body.configuration;
    expect(read).toEqual(stored);
  });

  it('keeps 24 hours lit round the clock and 0 hours dark, and says so live', async () => {
    const tent = await provisionDevice(owner, 'controller');

    // What 24 hours used to be written as: one second short of a day.
    const always = await write(tent, fridgeDocument({ daynight: { day: 6 * HOUR, night: 6 * HOUR - 1 } }));
    expect(always.daynight.night).toBeGreaterThanOrEqual(2 * 24 * HOUR);
    expect(always.daynight.day).toBe(always.daynight.night + 1);
    expect((await live(tent)).setpoints).toMatchObject({ active: 'day', period: 'constant', cycle: 'always_day', since: null, until: null });

    const dark = await write(tent, fridgeDocument({ daynight: { day: 6 * HOUR, night: 6 * HOUR } }));
    expect(dark.daynight).toEqual({ day: 6 * HOUR, night: 6 * HOUR });
    expect((await live(tent)).setpoints).toMatchObject({ active: 'night', period: 'constant', cycle: 'always_night' });
  });
});

describe('the half that holds now', () => {
  it('is the day inside the window by the clock, whatever the lamp reports', async () => {
    const tent = await provisionDevice(owner, 'controller');
    const simulator = await startSimulator(tent);
    try {
      await settle();
      const now = Date.now();
      await write(tent, fridgeDocument({ daynight: { day: utcSecondsOf(now - 2 * HOUR * 1000), night: utcSecondsOf(now + 2 * HOUR * 1000) } }));
      // The lamp held off from the cloud, or at 0 %: dark in the day.
      await simulator.reportStatus({ temperature: 25, humidity: 60 }, { light: 0 });
      await settle(1000);

      const answer = (await live(tent)).setpoints;
      expect(answer).toMatchObject({ active: 'day', period: 'day', cycle: 'schedule', transition: null });
      expect(Math.abs(Date.parse(answer.until) - (now + 2 * HOUR * 1000))).toBeLessThan(2 * MINUTES);
    } finally {
      await simulator.close();
    }
  });

  it('is the night round the clock while drying or germinating, and nothing while switched off', async () => {
    const fridge = await provisionDevice(owner, 'fridge');
    await write(fridge, fridgeDocument());

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { drying: true } })
      .expect(200);
    expect((await live(fridge)).setpoints).toMatchObject({ active: 'night', period: 'constant', cycle: 'drying', day: {} });

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { drying: false, mode: 'germination' } })
      .expect(200);
    expect((await live(fridge)).setpoints).toMatchObject({ active: 'night', period: 'constant', cycle: 'germination', night: { temperature: 21 } });

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { control: false } })
      .expect(200);
    expect((await live(fridge)).setpoints).toBeNull();
  });
});

describe('the targets a mode leaves alone', () => {
  it('keeps the day of a germinating fridge, the night of 24 hours, and tunes a drying room from the humidity it holds', async () => {
    const fridge = await provisionDevice(owner, 'fridge');
    await write(fridge, fridgeDocument());

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { mode: 'germination' } })
      .expect(200);
    // A page that shows the one figure germination holds sends it as the day too.
    const germinating = await write(
      fridge,
      fridgeDocument({ workmode: 'breed', day: { temperature: 24, humidity: 55 }, night: { temperature: 24, humidity: 55 } }),
    );
    expect(germinating).toMatchObject({ day: { temperature: 25, humidity: 60 }, night: { temperature: 24, humidity: 55 } });

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { mode: 'standard' } })
      .expect(200);
    // Going back puts the night germination wrote over back: 21 °C, not the germination's 24 °C.
    expect((await owner.client.get(`/v1/devices/${fridge.deviceId}`).expect(200)).body.configuration.night).toMatchObject({ temperature: 21 });
    const always = await write(
      fridge,
      fridgeDocument({
        daynight: { day: 6 * HOUR, night: 6 * HOUR - 1 },
        day: { temperature: 26, humidity: 60 },
        night: { temperature: 26, humidity: 60 },
      }),
    );
    expect(always).toMatchObject({ day: { temperature: 26, humidity: 60 }, night: { temperature: 21, humidity: 55 } });

    await owner.client
      .patch(`/v1/devices/${fridge.deviceId}/configuration`)
      .send({ set: { drying: true } })
      .expect(200);
    const drying = await write(fridge, fridgeDocument({ workmode: 'dry', night: { temperature: 18, humidity: 50 } }));
    expect(drying.daynight).toMatchObject({ maxDehumidifySeconds: 900, targetHumidityDiff: 0, useLongHumidityAvg: 1 });
  });
});

describe('what a plan step sends', () => {
  /** Long enough for the engine's twenty-second pass and the send that follows it. */
  const A_PASS_MS = 30_000;

  const step = (name: string, over: Record<string, unknown>) => ({
    name,
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'days' },
    settings: {},
    waitForConfirmation: false,
    confirmationMessage: null,
    ...over,
  });

  /** A controller lit 09:00-21:00 UTC, answering, with a plan of one step started. */
  const running = async (planStep: Record<string, unknown>): Promise<DeviceSimulator> => {
    const tent = await provisionDevice(owner, 'controller');
    const simulator = await startSimulator(tent);
    await settle();
    await write(tent, fridgeDocument({ daynight: { day: 9 * HOUR, night: 21 * HOUR } }));
    await owner.client
      .put(`/v1/devices/${tent.deviceId}/plan`)
      .send({ templateId: null, name: 'Light', loop: false, notify: { mode: 'off', email: null, writeEntries: false }, steps: [planStep] })
      .expect(200);
    await simulator.reportStatus({ temperature: 25 });
    simulator.clear();
    await owner.client.post(`/v1/devices/${tent.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    return simulator;
  };

  const sentWindow = async (simulator: DeviceSimulator) =>
    JSON.parse((await simulator.waitFor('configuration', A_PASS_MS, payload => JSON.parse(payload).daynight?.night !== 21 * HOUR)).payload).daynight;

  it('keeps the hour the grower set the light on at, and lengthens the day from it', async () => {
    const simulator = await running(step('Veg', { lightHours: 18 }));
    try {
      expect(await sentWindow(simulator)).toMatchObject({ day: 9 * HOUR, night: 3 * HOUR });
    } finally {
      await simulator.close();
    }
  }, 60_000);

  it('moves the hour only where the step names one', async () => {
    const simulator = await running(step('Flower', { lightHours: 12, settings: { daynight: { day: 5 * HOUR } } }));
    try {
      expect(await sentWindow(simulator)).toMatchObject({ day: 5 * HOUR, night: 17 * HOUR });
    } finally {
      await simulator.close();
    }
  }, 60_000);

  it('stores a step written with both times as the hour it sets and the hours it means', async () => {
    const tent = await provisionDevice(owner, 'controller');
    await write(tent, fridgeDocument());

    const plan = (
      await owner.client
        .put(`/v1/devices/${tent.deviceId}/plan`)
        .send({
          templateId: null,
          name: 'Carried',
          loop: false,
          notify: { mode: 'off', email: null, writeEntries: false },
          steps: [step('Veg', { settings: { daynight: { day: 4 * HOUR, night: 22 * HOUR } } }), step('Dark', { lightHours: 0 })],
        })
        .expect(200)
    ).body;

    expect(plan.steps.map((one: { settings: unknown; lightHours: number | null }) => [one.settings, one.lightHours])).toEqual([
      [{ daynight: { day: 4 * HOUR } }, 18],
      [{}, 0],
    ]);
  });
});

describe('a preset', () => {
  it('lengthens the day from the hour the light comes on, onto the second before midnight UTC', async () => {
    const tent = await provisionDevice(owner, 'controller');
    await write(tent, fridgeDocument({ daynight: { day: 6 * HOUR, night: 18 * HOUR } }));
    const spaceId = (await owner.client.get(`/v1/devices/${tent.deviceId}`).expect(200)).body.spaceId;

    await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(201);

    const read = (await owner.client.get(`/v1/devices/${tent.deviceId}/configuration`).expect(200)).body.configuration;
    expect(read.daynight).toEqual({ day: 6 * HOUR, night: 86_399 });
  });
});
