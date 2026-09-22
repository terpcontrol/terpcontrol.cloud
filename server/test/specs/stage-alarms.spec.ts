import { createAccount, Session } from '../support/api';
import { claimCodeOf, registerDevice } from '../support/device';

/**
 * The alarm rules a stage writes: a grow entering a phase puts the tent's
 * devices on the thresholds that stage binds, and the next phase moves them.
 *
 * What is asserted over HTTP is what a person sees on the alarms screen: four
 * rules the preset wrote, with the figures the flower preset implies, moving
 * with the stage and leaving alone both what the person did to them and the
 * rules the person wrote themselves.
 */

let owner: Session;
let tent: string;
let controller: string;
let grow: string;

const aRule = (over: Record<string, unknown> = {}) => ({
  name: 'My own rule',
  watch: { kind: 'reading', metric: 'temperature', upper: 33, lower: null },
  forSeconds: 0,
  severity: 'warning',
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
  ...over,
});

/** A controller claimed into a space, or into a space of its own when none is named. */
const claimAController = async (spaceId?: string): Promise<{ deviceId: string; spaceId: string }> => {
  const device = await registerDevice('controller');
  const claimed = await owner.client
    .post('/v1/devices/claims')
    .send({ code: await claimCodeOf(device.deviceId), ...(spaceId ? { spaceId } : {}) })
    .expect(201);

  return { deviceId: device.deviceId, spaceId: claimed.body.device.spaceId };
};

const rulesOf = async (deviceId: string): Promise<Record<string, unknown>[]> =>
  (await owner.client.get(`/v1/devices/${deviceId}/alarm-rules`).expect(200)).body.items;

const presetRulesOf = async (deviceId: string): Promise<Record<string, unknown>[]> =>
  (await rulesOf(deviceId)).filter(rule => rule.origin === 'preset');

/** The preset rules by what they watch, which is how a reader tells them apart. */
const byName = (rules: Record<string, unknown>[]): Record<string, Record<string, unknown>> =>
  Object.fromEntries(rules.map(rule => [rule.name as string, rule]));

const enterPhase = (stage: string, preset: string | null = null) => owner.client.post(`/v1/grows/${grow}/phases`).send({ stage, preset }).expect(201);

beforeAll(async () => {
  owner = await createAccount('stage-alarms-owner');
  ({ deviceId: controller, spaceId: tent } = await claimAController());

  const created = await owner.client
    .post('/v1/grows')
    .send({ name: 'Autumn run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 2 }], spaceId: tent })
    .expect(201);
  grow = created.body.id;
});

describe('the rules a stage writes', () => {
  let ownRule: string;

  it('writes the four rules the flower preset implies, with the figures of the board', async () => {
    ownRule = (await owner.client.post(`/v1/devices/${controller}/alarm-rules`).send(aRule()).expect(201)).body.id;

    await enterPhase('flowering');

    const rules = byName(await presetRulesOf(controller));
    expect(Object.keys(rules).sort()).toEqual(['CO₂ too high', 'Too cold', 'Too hot', 'Too humid']);

    expect(rules['Too hot']).toMatchObject({
      watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
      forSeconds: 600,
      severity: 'critical',
      origin: 'preset',
      presetId: 'flowering',
      enabled: true,
      delivery: { mode: 'routing', custom: null },
    });
    expect(rules['Too humid']).toMatchObject({ watch: { metric: 'humidity', upper: 60, lower: null }, forSeconds: 1200, severity: 'warning' });
    expect(rules['Too cold']).toMatchObject({ watch: { metric: 'temperature', upper: null, lower: 16 }, forSeconds: 900, severity: 'critical' });
    expect(rules['CO₂ too high']).toMatchObject({ watch: { metric: 'co2', upper: 1500, lower: null }, forSeconds: 600, severity: 'warning' });
    expect(rules['Too hot'].state).toMatchObject({ triggered: false, lastTriggeredAt: null });
  });

  it('keeps the bookkeeping that finds a rule again out of every answer', async () => {
    for (const rule of await rulesOf(controller)) expect(rule).not.toHaveProperty('presetKey');
  });

  it('moves the thresholds with the next stage and leaves what a person did to a rule alone', async () => {
    const before = byName(await presetRulesOf(controller));
    await owner.client.patch(`/v1/alarm-rules/${before['Too humid'].id}`).send({ enabled: false, severity: 'info' }).expect(200);

    await enterPhase('flowering', 'late_flowering');

    const rules = byName(await presetRulesOf(controller));
    expect(Object.keys(rules)).toHaveLength(4);
    expect(rules['Too hot']).toMatchObject({ id: before['Too hot'].id, watch: { upper: 29 }, presetId: 'flowering:late_flowering' });
    expect(rules['Too humid']).toMatchObject({ id: before['Too humid'].id, watch: { upper: 55 }, enabled: false, severity: 'info' });
    expect(rules['Too cold']).toMatchObject({ id: before['Too cold'].id, watch: { lower: 14 } });
  });

  it('takes them away for a stage with no climate, and leaves the rules a person wrote', async () => {
    await enterPhase('curing');

    expect(await presetRulesOf(controller)).toEqual([]);
    expect((await rulesOf(controller)).map(rule => rule.id)).toContain(ownRule);
  });
});

describe('a device that arrives in a tent already in a stage', () => {
  it('takes the thresholds of that stage when claimed into the tent', async () => {
    await enterPhase('vegetative');

    const { deviceId } = await claimAController(tent);

    const rules = byName(await presetRulesOf(deviceId));
    expect(Object.keys(rules)).toHaveLength(4);
    expect(rules['Too hot']).toMatchObject({ watch: { upper: 31 }, presetId: 'vegetative' });
  });

  it('takes them when moved into the tent, and keeps them when moved out', async () => {
    const { deviceId, spaceId: shelf } = await claimAController();
    expect(await presetRulesOf(deviceId)).toEqual([]);

    await owner.client.patch(`/v1/devices/${deviceId}`).send({ spaceId: tent }).expect(200);
    expect(byName(await presetRulesOf(deviceId))['Too cold']).toMatchObject({ watch: { lower: 18 }, presetId: 'vegetative' });

    await owner.client.patch(`/v1/devices/${deviceId}`).send({ spaceId: shelf }).expect(200);
    expect(await presetRulesOf(deviceId)).toHaveLength(4);
  });
});
