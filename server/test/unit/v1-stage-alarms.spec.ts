import { stageAlarmBands } from '@fg2/shared-types/v1-schemas';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { AlarmEngineService } from '@modules/alarm/alarm-engine.service';
import { AlarmRuleService } from '@modules/alarm/alarm-rule.service';
import { GerminationAlarmsService } from '@modules/alarm/germination-alarms.service';
import { StageAlarmsService } from '@modules/alarm/stage-alarms.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { StageAlarms } from '@modules/v1/phase/stage-alarms.port';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The alarm thresholds a stage binds.
 *
 * The table is held against the board the alarms screen was decided on, and the
 * service against what a person may have done to a rule in the meantime: the
 * next stage moves the band and nothing else, because a rule switched off for a
 * drying room must not come back on when the jars go in.
 */

const DEVICE = 'device-controller';
const OTHER = 'device-other';
const TENT = 'space-tent';
const GROW = 'grow-1';

let db: V1TestDatabase;
let service: StageAlarmsService;

const byKey = async (deviceId = DEVICE) =>
  Object.fromEntries((await db.alarmRules.find({ deviceId, origin: 'preset' }).lean()).map(rule => [rule.presetKey, rule]));

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  service = new StageAlarmsService(db.alarmRules, new AlarmRuleService(db.alarmRules, db.alerts));
});

describe('the bands a stage implies', () => {
  it('reproduces the board for a tent in flower', () => {
    expect(stageAlarmBands('flowering', null)).toEqual([
      { key: 'too_hot', watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null }, forSeconds: 600, severity: 'critical' },
      { key: 'too_humid', watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null }, forSeconds: 1200, severity: 'warning' },
      { key: 'too_cold', watch: { kind: 'reading', metric: 'temperature', upper: null, lower: 16 }, forSeconds: 900, severity: 'critical' },
      { key: 'co2_high', watch: { kind: 'reading', metric: 'co2', upper: 1500, lower: null }, forSeconds: 600, severity: 'warning' },
    ]);
  });

  it('moves with the preset on top of the stage', () => {
    const bands = Object.fromEntries((stageAlarmBands('flowering', 'late_flowering') ?? []).map(band => [band.key, band.watch]));

    expect(bands.too_hot.upper).toBe(29);
    expect(bands.too_humid.upper).toBe(55);
    expect(bands.too_cold.lower).toBe(14);
  });

  it('watches a drying room too, which has a climate of its own', () => {
    const bands = Object.fromEntries((stageAlarmBands('drying', null) ?? []).map(band => [band.key, band.watch]));

    expect(bands.too_hot.upper).toBe(23);
    expect(bands.too_humid.upper).toBe(68);
    expect(bands.too_cold.lower).toBe(14);
  });

  it('has nothing to say about a jar', () => {
    expect(stageAlarmBands('curing', null)).toBeNull();
  });

  /**
   * Germination holds one temperature in the dark and no humidity, so its
   * "too humid" is the line where germination itself goes wrong rather than ten
   * points over a target - and the engine rests it unless the grower asks to be
   * warned (`restsInGermination`), and watches it at that line however the
   * device came to germinate (`watchNow`).
   */
  it('watches germination´s one temperature, and the air past where seeds go mouldy', () => {
    const bands = Object.fromEntries((stageAlarmBands('germination', null) ?? []).map(band => [band.key, band]));

    expect(bands.too_hot.watch.upper).toBe(29);
    expect(bands.too_cold.watch.lower).toBe(20);
    expect(bands.too_humid).toEqual({
      key: 'too_humid',
      watch: { kind: 'reading', metric: 'humidity', upper: 90, lower: null },
      forSeconds: 1200,
      severity: 'warning',
    });
  });
});

describe('the rules the stage writes on a device', () => {
  it('writes one per band, fresh and on', async () => {
    await service.applyStage(DEVICE, 'flowering', null);

    const rules = await byKey();
    expect(Object.keys(rules).sort()).toEqual(['co2_high', 'too_cold', 'too_hot', 'too_humid']);
    expect(rules.too_hot).toMatchObject({
      name: 'Too hot',
      origin: 'preset',
      presetId: 'flowering',
      enabled: true,
      severity: 'critical',
      cooldownSeconds: 0,
      // A critical rule says it again until it is resolved; a warning is said once.
      repeatSeconds: 30 * 60,
      silencedUntil: null,
      delivery: { mode: 'routing', custom: null },
      state: { triggered: false, lastTriggeredAt: null, extremeValue: null },
    });
    expect(rules.too_hot.watch).toMatchObject({ kind: 'reading', metric: 'temperature', upper: 30, lower: null });
  });

  it('moves the band and keeps what the person and the engine wrote on the rule', async () => {
    await service.applyStage(DEVICE, 'flowering', null);
    const before = await byKey();
    const silencedUntil = new Date('2030-01-01T00:00:00.000Z');
    await db.alarmRules.updateOne(
      { id: before.too_humid.id },
      { $set: { enabled: false, severity: 'info', cooldownSeconds: 900, silencedUntil, 'state.triggered': true, name: 'Renamed by hand' } },
    );

    await service.applyStage(DEVICE, 'flowering', 'late_flowering');

    const after = await byKey();
    expect(after.too_humid).toMatchObject({
      id: before.too_humid.id,
      name: 'Too humid',
      presetId: 'flowering:late_flowering',
      enabled: false,
      severity: 'info',
      cooldownSeconds: 900,
      silencedUntil,
      state: { triggered: true },
    });
    expect(after.too_humid.watch).toMatchObject({ upper: 55 });
    expect(after.too_hot).toMatchObject({ id: before.too_hot.id });
    expect(after.too_hot.watch).toMatchObject({ upper: 29 });
  });

  it('takes the rules away for a stage with no climate, settling their open episodes', async () => {
    await service.applyStage(DEVICE, 'flowering', null);
    const { too_hot } = await byKey();
    await db.alerts.create({
      id: 'alert-1',
      ruleId: too_hot.id,
      deviceId: DEVICE,
      cameraId: null,
      spaceId: null,
      kind: 'threshold',
      severity: 'critical',
      startedAt: new Date(),
      resolvedAt: null,
      value: 31,
      extremeValue: 31,
    });

    await service.applyStage(DEVICE, 'curing', null);

    expect(await byKey()).toEqual({});
    expect((await db.alerts.findOne({ id: 'alert-1' }).lean())?.resolvedAt).toBeInstanceOf(Date);
  });

  it('touches neither the rules a person wrote nor another device´s', async () => {
    const own = await new AlarmRuleService(db.alarmRules, db.alerts).create(DEVICE, {
      name: 'Mine',
      watch: { kind: 'reading', metric: 'temperature', upper: 35, lower: null },
      forSeconds: 0,
      severity: 'warning',
      enabled: true,
      cooldownSeconds: 0,
      repeatSeconds: 0,
      delivery: { mode: 'routing', custom: null },
    });
    await service.applyStage(OTHER, 'flowering', null);

    await service.applyStage(DEVICE, 'flowering', null);
    await service.applyStage(DEVICE, 'curing', null);

    expect(await db.alarmRules.findOne({ id: own.id }).lean()).toMatchObject({ name: 'Mine', origin: 'human' });
    expect(Object.keys(await byKey(OTHER))).toHaveLength(4);
  });
});

/**
 * Owner's decision G2, set from somewhere a phase is not: a device put into
 * germination from Steuerung, the operating mode or a plan has the bands of the
 * stage before - or none - and the grower who asks to be warned is given the
 * stage's "too humid" where there is none to warn with.
 */
describe('a device that germinates and was asked to warn', () => {
  const germinating = (choices: Record<string, boolean> | null, over: Record<string, unknown> = {}) =>
    db.devices.create({
      id: DEVICE,
      type: 'controller',
      ownerId: 'user-owner',
      configuration: { workmode: 'breed', night: { temperature: 24, humidity: 60 } },
      germinationChoices: choices,
      ...over,
    });
  const told = () => {
    const engine = { restNow: async (deviceId: string) => void rested.push(deviceId) } as unknown as AlarmEngineService;
    return new GerminationAlarmsService(db.devices, service, engine);
  };
  let rested: string[];

  beforeEach(() => {
    rested = [];
  });

  it('gets the stage´s "too humid" at germination´s line where it has none', async () => {
    await germinating({ warnTooHumid: true, humidifierHolds: true });

    await told().germinationChanged(DEVICE);

    const rules = await byKey();
    expect(Object.keys(rules)).toEqual(['too_humid']);
    expect(rules.too_humid).toMatchObject({ name: 'Too humid', presetId: 'germination', enabled: true, severity: 'warning', forSeconds: 1200 });
    expect(rules.too_humid.watch).toMatchObject({ metric: 'humidity', upper: 90, lower: null });
    expect(rested).toEqual([]);
  });

  it('leaves the one it has as it is, switched off by somebody included', async () => {
    await germinating({ warnTooHumid: true, humidifierHolds: true });
    await service.applyStage(DEVICE, 'vegetative', null);
    const before = await byKey();
    await db.alarmRules.updateOne({ id: before.too_humid.id }, { $set: { enabled: false } });

    await told().germinationChanged(DEVICE);

    const after = await byKey();
    expect(after.too_humid).toMatchObject({ id: before.too_humid.id, enabled: false, presetId: 'vegetative' });
    expect(after.too_humid.watch).toEqual(before.too_humid.watch);
  });

  it('rests it at once where the grower asked for no warning, and writes nothing for a device that does not germinate or is nobody´s', async () => {
    await germinating(null);
    await told().germinationChanged(DEVICE);
    expect(rested).toEqual([DEVICE]);
    expect(await byKey()).toEqual({});

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'configuration.workmode': 'small', germinationChoices: { warnTooHumid: true } } });
    await told().germinationChanged(DEVICE);
    await db.devices.updateOne({ id: DEVICE }, { $set: { 'configuration.workmode': 'breed', ownerId: null } });
    await told().germinationChanged(DEVICE);
    expect(await byKey()).toEqual({});
    expect(rested).toEqual([DEVICE]);
  });
});

describe('a device stood in a space', () => {
  let applied: { deviceId: string; stage: string; preset: string | null }[];
  let phases: PhaseWriterService;

  const aGrow = (phases: Record<string, unknown>[], placements: Record<string, unknown>[]) =>
    db.grows.create({
      id: GROW,
      ownerId: 'user-owner',
      name: 'Run',
      slug: 'run',
      type: 'photoperiod',
      visibility: 'private',
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      endedAt: null,
      phases,
      placements,
    });

  const at = (day: number) => new Date(`2026-05-${String(day).padStart(2, '0')}T00:00:00.000Z`);

  beforeEach(() => {
    applied = [];
    const alarms: StageAlarms = { applyStage: async (deviceId, stage, preset) => void applied.push({ deviceId, stage, preset }) };
    phases = new PhaseWriterService(db.grows, new EntryWriterService(db.entries), db.entries, db.devices, alarms);
  });

  it('takes the stage the plants standing there are in', async () => {
    await aGrow(
      [{ id: 'p1', stage: 'flowering', preset: null, startedAt: at(2), source: 'human', plantIds: null }],
      [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }],
    );

    await phases.restateThresholds(DEVICE, TENT);

    expect(applied).toEqual([{ deviceId: DEVICE, stage: 'flowering', preset: null }]);
  });

  it('takes the phase of the plants in this space, not of the ones that were moved on', async () => {
    await aGrow(
      [
        { id: 'p1', stage: 'flowering', preset: null, startedAt: at(2), source: 'human', plantIds: null },
        { id: 'p2', stage: 'drying', preset: null, startedAt: at(3), source: 'human', plantIds: ['plant-b'] },
      ],
      [
        { id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: ['plant-a'] },
        { id: 'pl2', spaceId: 'space-drying', startedAt: at(3), endedAt: null, plantIds: ['plant-b'] },
      ],
    );

    await phases.restateThresholds(DEVICE, TENT);

    expect(applied).toEqual([{ deviceId: DEVICE, stage: 'flowering', preset: null }]);
  });

  it('leaves a device alone where nothing stands, or where the grow has no phase yet', async () => {
    await phases.restateThresholds(DEVICE, TENT);
    await aGrow([], [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }]);
    await phases.restateThresholds(DEVICE, TENT);

    expect(applied).toEqual([]);
  });

  it('is told of every device standing where the phase is entered', async () => {
    await aGrow([], [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }]);
    await db.devices.create([
      { id: DEVICE, type: 'controller', ownerId: 'user-owner', spaceId: TENT },
      { id: OTHER, type: 'plug', ownerId: 'user-owner', spaceId: TENT },
      { id: 'device-elsewhere', type: 'controller', ownerId: 'user-owner', spaceId: 'space-other' },
    ]);

    await phases.setPhase({
      growId: GROW,
      stage: 'vegetative',
      preset: null,
      source: 'human',
      setBy: 'user-owner',
      plantIds: null,
      deviceId: DEVICE,
      spaceId: TENT,
      targets: null,
    });

    expect(applied.map(call => call.deviceId).sort()).toEqual([DEVICE, OTHER]);
  });

  /**
   * A germination taken back left the alarms at germination's bands - "Zu
   * kalt" under 20 °C, "Zu feucht" over 90 % - over a grow that stood in Veg
   * again. The stage left standing binds them, as a correction makes it.
   */
  it('gives the alarms back to the phase left standing when the one the grow stood in is taken back', async () => {
    await aGrow(
      [
        { id: 'p1', stage: 'vegetative', preset: null, startedAt: at(2), source: 'human', plantIds: null },
        { id: 'p2', stage: 'germination', preset: null, startedAt: at(4), source: 'human', plantIds: null },
        { id: 'p3', stage: 'germination', preset: null, startedAt: at(3), source: 'human', plantIds: null },
      ],
      [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }],
    );
    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: 'user-owner', spaceId: TENT, configuration: { workmode: 'small' } });

    // An earlier phase taken back leaves the one standing, and its alarms, alone.
    await phases.removePhase(GROW, 'p3');
    expect(applied).toEqual([]);

    await phases.removePhase(GROW, 'p2');
    expect(applied).toEqual([{ deviceId: DEVICE, stage: 'vegetative', preset: null }]);

    // The last one taken back leaves the grow no phase, and the alarms as they are.
    await phases.removePhase(GROW, 'p1');
    expect(applied).toHaveLength(1);
  });
});
