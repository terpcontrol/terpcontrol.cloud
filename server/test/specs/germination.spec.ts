import { createAccount, Session } from '../support/api';
import { DeviceCredentials, DeviceType, provisionDevice, settle, startSimulator } from '../support/device';

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

/** The rules the stage wrote on a device, by name, with what each watches. */
const stageRules = async (device: DeviceCredentials): Promise<Record<string, unknown>> => {
  const rules = (await owner.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200)).body.items.filter(
    (rule: { origin: string }) => rule.origin === 'preset',
  );
  return Object.fromEntries(rules.map((rule: { name: string; watch: unknown }) => [rule.name, rule.watch]));
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

  it('watches the temperature it holds, and the air past where seeds go mouldy', async () => {
    const { device, spaceId } = await placed('controller');
    await growIn(spaceId);

    await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'germination' }).expect(201);

    const rules = (await owner.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200)).body.items.filter(
      (rule: { origin: string }) => rule.origin === 'preset',
    );
    const watched = Object.fromEntries(rules.map((rule: { name: string; watch: unknown }) => [rule.name, rule.watch]));
    expect(Object.keys(watched).sort()).toEqual(['CO₂ too high', 'Too cold', 'Too hot', 'Too humid']);
    expect(watched['Too hot']).toMatchObject({ metric: 'temperature', upper: 29 });
    expect(watched['Too cold']).toMatchObject({ metric: 'temperature', lower: 20 });
    // It rests unless the grower asks to be warned (`a "too humid" alarm in germination` below).
    expect(watched['Too humid']).toMatchObject({ metric: 'humidity', upper: 90, lower: null });
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

  it('leaves the alarms of a device that keeps its light where only the phase is written', async () => {
    const { device, spaceId } = await placed('controller');
    const grow = await growIn(spaceId);
    await owner.client.post(`/v1/grows/${grow}/phases`).send({ stage: 'flowering', climate: true }).expect(201);
    const flowering = await stageRules(device);
    expect(Object.keys(flowering).sort()).toEqual(['CO₂ too high', 'Too cold', 'Too hot', 'Too humid']);

    await owner.client.post(`/v1/grows/${grow}/phases`).send({ stage: 'germination' }).expect(201);

    // "Too cold" under 20 °C would trip every flowering night, which keeps its 18 °C.
    expect(await stageRules(device)).toEqual(flowering);
  });

  it('takes the germination alarms where the device already germinates, or the climate follows the phase', async () => {
    const dark = await placed('controller');
    const seeds = await growIn(dark.spaceId);
    await owner.client
      .put(`/v1/devices/${dark.device.deviceId}/configuration`)
      .send({ configuration: document({ night: { temperature: 24, humidity: 55 } }), germination: true })
      .expect(200);
    await owner.client.post(`/v1/grows/${seeds}/phases`).send({ stage: 'germination' }).expect(201);
    expect(Object.keys(await stageRules(dark.device)).sort()).toEqual(['CO₂ too high', 'Too cold', 'Too hot', 'Too humid']);

    // The new-grow sheet: the phase recorded first, and the place put on its climate a moment later.
    const lit = await placed('fridge');
    const sown = await growIn(lit.spaceId);
    await owner.client.post(`/v1/grows/${sown}/phases`).send({ stage: 'germination' }).expect(201);
    expect(await stageRules(lit.device)).toEqual({});
    await owner.client.post(`/v1/spaces/${lit.spaceId}/preset-applications`).send({ stage: 'germination' }).expect(201);
    expect(await configurationOf(lit.device)).toMatchObject({ workmode: 'breed' });
    expect(await stageRules(lit.device)).toMatchObject({ 'Too cold': { lower: 20 }, 'Too hot': { upper: 29 }, 'Too humid': { upper: 90 } });
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

/**
 * What germination does about the humidity (owner's decision G2): the grower
 * chooses whether the "too humid" alarms go on warning and whether a
 * humidifier socket goes on holding the night's humidity. Chosen wherever
 * germination is set - the targets, the operating mode, a phase or a preset
 * with its climate, a plan step - and kept on the device.
 */
describe('the choices germination makes about the humidity', () => {
  const bandOf = async (device: DeviceCredentials) => (await configurationOf(device)).daynight?.targetHumidityDiff;

  it('rest the alarms and keep a humidifier holding until somebody says otherwise, and are kept where the targets are saved', async () => {
    const { device } = await placed('controller');
    expect((await controlOf(device)).germinationChoices).toEqual({ warnTooHumid: false, humidifierHolds: true });

    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({
        configuration: document({ night: { temperature: 24, humidity: 80 } }),
        germination: true,
        germinationChoices: { warnTooHumid: true, humidifierHolds: true },
      })
      .expect(200);

    expect(await controlOf(device)).toMatchObject({ mode: 'germination', germinationChoices: { warnTooHumid: true, humidifierHolds: true } });
    // The humidity a humidifier holds is the night's, written as the page showed it.
    expect(await configurationOf(device)).toMatchObject({ workmode: 'breed', night: { temperature: 24, humidity: 80 } });
  });

  it('rest a humidifier for the germination a preset starts, and only for germination', async () => {
    const { device, spaceId } = await placed('controller');

    await owner.client
      .post(`/v1/spaces/${spaceId}/preset-applications`)
      .send({ stage: 'germination', germinationChoices: { humidifierHolds: false } })
      .expect(201);
    expect(await bandOf(device)).toBe(100);
    expect((await controlOf(device)).germinationChoices).toEqual({ warnTooHumid: false, humidifierHolds: false });

    // The seedling brings the light back, and the humidifier holds again with the band it had.
    await owner.client
      .post(`/v1/spaces/${spaceId}/preset-applications`)
      .send({ stage: 'seedling', germinationChoices: { warnTooHumid: true } })
      .expect(201);
    expect(await bandOf(device)).not.toBe(100);
    // The choice was for that germination, and a choice sent with another stage is none: the defaults hold again.
    expect((await controlOf(device)).germinationChoices).toEqual({ warnTooHumid: false, humidifierHolds: true });
  });

  it('come with a phase that writes the germination climate, and with the operating mode by name', async () => {
    const { device, spaceId } = await placed('fridge');
    const grow = await growIn(spaceId);

    await owner.client
      .post(`/v1/grows/${grow}/phases`)
      .send({ stage: 'germination', climate: true, germinationChoices: { warnTooHumid: true, humidifierHolds: false } })
      .expect(201);
    expect(await controlOf(device)).toMatchObject({ mode: 'germination', germinationChoices: { warnTooHumid: true, humidifierHolds: false } });
    expect(await bandOf(device)).toBe(100);

    const answer = await owner.client
      .patch(`/v1/devices/${device.deviceId}/configuration`)
      .send({ set: { germinationHumidifier: true, germinationWarnTooHumid: false } })
      .expect(200);
    expect(answer.body.control.germinationChoices).toEqual({ warnTooHumid: false, humidifierHolds: true });
    expect(await bandOf(device)).toBe(5);
  });

  it('are kept on a germination step of a plan, and on no other', async () => {
    const { device } = await placed('controller');
    const choices = { warnTooHumid: true, humidifierHolds: false };

    const plan = await owner.client
      .put(`/v1/devices/${device.deviceId}/plan`)
      .send({
        templateId: null,
        name: 'Seeds',
        loop: false,
        notify: { mode: 'off', email: null, writeEntries: false },
        steps: [
          {
            name: 'Keimung',
            stage: 'germination',
            duration: { value: 4, unit: 'days' },
            settings: { night: { temperature: 24 } },
            waitForConfirmation: false,
            confirmationMessage: null,
            germinationChoices: choices,
          },
          {
            name: 'Sämling',
            stage: 'seedling',
            duration: { value: 2, unit: 'weeks' },
            settings: {},
            waitForConfirmation: false,
            confirmationMessage: null,
            germinationChoices: choices,
          },
        ],
      })
      .expect(200);

    expect(plan.body.steps.map((step: { germinationChoices: unknown }) => step.germinationChoices)).toEqual([choices, null]);
  });

  it('rest the stage´s "too humid" while the device germinates, give one to a device asked to warn, and leave a person´s own awake', async () => {
    const { device } = await placed('controller');
    const simulator = await startSimulator(device);
    const alertsOf = async (ruleId: string) =>
      (
        (await owner.client.get(`/v1/alerts?deviceId=${device.deviceId}`).expect(200)).body.items as {
          ruleId: string;
          resolvedAt: string | null;
          rested: boolean;
          watched: { watch: { upper: number } };
        }[]
      ).filter(alert => alert.ruleId === ruleId);
    try {
      await settle();
      const own = (
        await owner.client
          .post(`/v1/devices/${device.deviceId}/alarm-rules`)
          .send({
            name: 'Zu feucht',
            watch: { kind: 'reading', metric: 'humidity', upper: 70, lower: null },
            forSeconds: 0,
            severity: 'warning',
            enabled: true,
            cooldownSeconds: 0,
            repeatSeconds: 0,
            delivery: { mode: 'routing', custom: null },
          })
          .expect(201)
      ).body;
      await owner.client
        .patch(`/v1/devices/${device.deviceId}/configuration`)
        .send({ set: { mode: 'germination' } })
        .expect(200);

      // An alarm a person set up is theirs, and watches through germination.
      await simulator.reportStatus({ temperature: 24, humidity: 92 });
      await settle(1500);
      expect(await alertsOf(own.id)).toHaveLength(1);

      // Asked to warn, a device whose germination no phase wrote gets the stage's "too humid", at germination's line.
      await owner.client
        .patch(`/v1/devices/${device.deviceId}/configuration`)
        .send({ set: { germinationWarnTooHumid: true } })
        .expect(200);
      const rules = (await owner.client.get(`/v1/devices/${device.deviceId}/alarm-rules`).expect(200)).body.items as {
        id: string;
        origin: string;
        watch: { metric: string; upper: number };
      }[];
      const stage = rules.find(one => one.origin === 'preset' && one.watch.metric === 'humidity')!;
      expect(stage.watch).toMatchObject({ upper: 90 });
      // Twenty minutes is longer than a test waits; what a person sets on a stage's rule stays the stage's rule.
      await owner.client.patch(`/v1/alarm-rules/${stage.id}`).send({ forSeconds: 0 }).expect(200);

      await simulator.reportStatus({ temperature: 24, humidity: 93 });
      await settle(1500);
      const raised = await alertsOf(stage.id);
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({ resolvedAt: null, rested: false, watched: { watch: { upper: 90 } } });

      // Told to rest, the open alert goes quiet with the save, said to have rested rather than resolved.
      await owner.client
        .patch(`/v1/devices/${device.deviceId}/configuration`)
        .send({ set: { germinationWarnTooHumid: false } })
        .expect(200);
      const rested = await alertsOf(stage.id);
      expect(rested).toHaveLength(1);
      expect(rested[0].resolvedAt).not.toBeNull();
      expect(rested[0].rested).toBe(true);
    } finally {
      await simulator.close();
    }
  });
});
