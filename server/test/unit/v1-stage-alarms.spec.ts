import type { PlanStep } from '@fg2/shared-types/v1';
import { stageAlarmBands } from '@fg2/shared-types/v1-schemas';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MailService } from '@modules/mail/mail.service';
import { PlanEngineService } from '@modules/v1/plan/plan-engine.service';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { AlarmDeliveryService } from '@modules/alarm/alarm-delivery.service';
import { AlarmEngineService } from '@modules/alarm/alarm-engine.service';
import { AlarmRuleService } from '@modules/alarm/alarm-rule.service';
import { GerminationAlarmsService } from '@modules/alarm/germination-alarms.service';
import { AlertService } from '@modules/alarm/alert.service';
import { StageAlarmsService } from '@modules/alarm/stage-alarms.service';
import { DataService } from '@modules/data/data.service';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { STAGE_ALARMS, StageAlarms } from '@modules/v1/phase/stage-alarms.port';
import { presetConfiguration } from '@modules/v1/space/climate-presets';
import { ClimatePresetsService } from '@modules/v1/space/climate-presets.service';
import { deviceStackOn } from './support/device-stack';
import { accessOn, growsOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

/**
 * The alarm thresholds a stage binds.
 *
 * The table is held against the board the alarms screen was decided on, and the
 * service against what a person may have done to a rule in the meantime: the
 * next stage moves the band and nothing else, because a rule switched off for a
 * drying room must not come back on when the jars go in.
 */

const PLAN_STEP: PlanStep = {
  id: 'step-1',
  name: 'Blüte',
  stage: null,
  preset: null,
  duration: { value: 1, unit: 'weeks' },
  settings: {},
  lightHours: null,
  waitForConfirmation: false,
  confirmationMessage: null,
  germinationChoices: null,
};

const DEVICE = 'device-controller';
const OTHER = 'device-other';
const TENT = 'space-tent';
const GROW = 'grow-1';

const db = useV1TestDatabase();
let service: StageAlarmsService;

const byKey = async (deviceId = DEVICE) =>
  Object.fromEntries((await db.alarmRules.find({ deviceId, origin: 'preset' }).lean()).map(rule => [rule.presetKey, rule]));

beforeEach(async () => {
  await db.reset();
  service = new StageAlarmsService(db.alarmRules, new AlarmRuleService(db.alarmRules, db.alerts), db.devices);
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

  it('gives a lamp module and a fan only the bands they can measure, and takes a CO2 band one was given away', async () => {
    await db.devices.insertMany([
      { id: 'lamp', type: 'light', ownerId: 'owner', spaceId: TENT },
      { id: 'fan', type: 'fan', ownerId: 'owner', spaceId: TENT },
    ]);
    await db.alarmRules.create({
      id: 'old-co2',
      deviceId: 'lamp',
      origin: 'preset',
      presetKey: 'co2_high',
      name: 'CO₂ too high',
      watch: { kind: 'reading', metric: 'co2', upper: 1500, lower: null },
      forSeconds: 600,
      severity: 'warning',
    });

    await service.applyStage('lamp', 'flowering', null);
    await service.applyStage('fan', 'flowering', null);

    expect(Object.keys(await byKey('lamp')).sort()).toEqual(['too_cold', 'too_hot', 'too_humid']);
    expect(Object.keys(await byKey('fan')).sort()).toEqual(['too_cold', 'too_hot', 'too_humid']);
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
  let dropped: string[];
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
    dropped = [];
    const alarms: StageAlarms = {
      applyStage: async (deviceId, stage, preset) => void applied.push({ deviceId, stage, preset }),
      followClimate: async () => undefined,
      dropStage: async deviceId => void dropped.push(deviceId),
      leaveClimate: async () => undefined,
      climateHere: async () => null,
      stageOf: deviceIds => service.stageOf(deviceIds),
    };
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

  /**
   * No climate was written where nothing stands and nothing is watched: a fan claimed "An einem neuen Ort" had first
   * been joined to a tent in flower, and watched its empty tent for 60 %.
   */
  it('drops the bands it brought where nothing stands, or where the grow has no phase yet', async () => {
    await phases.restateThresholds(DEVICE, TENT);
    await aGrow([], [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }]);
    await phases.restateThresholds(DEVICE, TENT);

    expect(applied).toEqual([]);
    expect(dropped).toEqual([DEVICE, DEVICE]);
  });

  it('takes the stage the bands of the devices already there come from, not a stage recorded beside it since', async () => {
    await aGrow(
      [{ id: 'p1', stage: 'vegetative', preset: null, startedAt: at(4), source: 'human', plantIds: null }],
      [{ id: 'pl1', spaceId: TENT, startedAt: at(3), endedAt: null, plantIds: null }],
    );
    await db.devices.create({ id: OTHER, type: 'controller', ownerId: 'user-owner', spaceId: TENT });
    await service.applyStage(OTHER, 'flowering', 'late_flowering');

    await phases.restateThresholds(DEVICE, TENT);

    expect(applied).toEqual([{ deviceId: DEVICE, stage: 'flowering', preset: 'late_flowering' }]);
  });

  it('moves no threshold for a stage only recorded, corrected or taken back: they are the climate´s that was written', async () => {
    await aGrow(
      [
        { id: 'p1', stage: 'vegetative', preset: null, startedAt: at(2), source: 'human', plantIds: null },
        { id: 'p2', stage: 'germination', preset: null, startedAt: at(4), source: 'human', plantIds: null },
      ],
      [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }],
    );
    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: 'user-owner', spaceId: TENT, configuration: { workmode: 'small' } });
    const recorded = {
      growId: GROW,
      preset: null,
      source: 'human' as const,
      setBy: 'user-owner',
      plantIds: null,
      deviceId: DEVICE,
      spaceId: TENT,
      targets: null,
    };

    await phases.correctPhase(GROW, 'p2', { stage: 'seedling' });
    await phases.removePhase(GROW, 'p2');
    await phases.setPhase({ ...recorded, stage: 'flowering', climateWritten: false });
    expect(applied).toEqual([]);

    // Nor does one written with its climate: the write of the climate moves them (`DeviceConfigurationService.store`).
    await phases.setPhase({ ...recorded, stage: 'drying' });
    expect(applied).toEqual([]);
  });

  it('takes the bands of a stage recorded over a place that already runs its mode, whose climate it then is', async () => {
    await aGrow([], [{ id: 'pl1', spaceId: TENT, startedAt: at(1), endedAt: null, plantIds: null }]);
    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: 'user-owner', spaceId: TENT, configuration: { workmode: 'breed' } });
    const recorded = { growId: GROW, preset: null, source: 'human' as const, setBy: 'user-owner', plantIds: null, deviceId: DEVICE, spaceId: TENT };

    await phases.setPhase({ ...recorded, targets: null, stage: 'drying', climateWritten: false });
    expect(applied).toEqual([]);
    await phases.setPhase({ ...recorded, targets: null, stage: 'germination', climateWritten: false });
    expect(applied).toEqual([{ deviceId: DEVICE, stage: 'germination', preset: null }]);
  });
});

/**
 * A place's thresholds follow the climate written there. A second grow started in Veg beside one in flower records its
 * stage and writes no climate - and rewrote the flowering tent's bands all the same, which closed its open "too humid"
 * while the air stayed at 62 %.
 */
describe('a second grow started beside one in flower', () => {
  it('leaves the bands 16 / 60 / 30 and the open "too humid" open', async () => {
    const writer = new EntryWriterService(db.entries);
    const alerts = new AlertService(db.alerts, writer, { deliver: async () => undefined } as unknown as AlarmDeliveryService);
    const engine = new AlarmEngineService(db.alarmRules, db.devices, { points: async () => [] } as unknown as DataService, alerts);
    const phases = new PhaseWriterService(db.grows, writer, db.entries, db.devices, service);
    const grows = growsOn(db, accessOn(db), { writer, phases });
    const humid = (at: Date) => engine.onSample({ deviceId: DEVICE, measuredAt: at, values: { humidity: 62 }, outputs: {} });
    const since = new Date(Date.now() - 30 * 24 * 3600_000);

    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: 'user-owner', spaceId: TENT, configuration: { workmode: 'small' } });
    await db.grows.create({
      id: 'grow-blue-dream',
      ownerId: 'user-owner',
      name: 'Blue Dream',
      slug: 'blue-dream',
      type: 'photoperiod',
      visibility: 'private',
      startedAt: since,
      endedAt: null,
      phases: [{ id: 'p-flower', stage: 'flowering', preset: null, startedAt: since, source: 'human', plantIds: null }],
      placements: [{ id: 'pl-blue', spaceId: TENT, startedAt: since, endedAt: null, plantIds: null }],
    });
    await service.applyStage(DEVICE, 'flowering', null);
    await db.alarmRules.updateOne({ deviceId: DEVICE, presetKey: 'too_humid' }, { $set: { forSeconds: 0 } });
    await humid(new Date(Date.now() - 60_000));
    const open = await db.alerts.findOne({ resolvedAt: null }).lean();
    expect(open).toMatchObject({ deviceId: DEVICE, spaceId: TENT });

    await db.grows.create({
      id: GROW,
      ownerId: 'user-owner',
      name: 'Zweitgrow',
      slug: 'zweitgrow',
      type: 'photoperiod',
      visibility: 'private',
      startedAt: new Date(),
      endedAt: null,
      phases: [],
      placements: [{ id: 'pl-second', spaceId: TENT, startedAt: new Date(), endedAt: null, plantIds: null }],
    });
    await grows.addPhase(GROW, { stage: 'vegetative' }, 'user-owner', { authors: false, counts: false, weights: false });
    await humid(new Date());

    const bands = await byKey();
    expect([bands.too_cold.watch.lower, bands.too_humid.watch.upper, bands.too_hot.watch.upper]).toEqual([16, 60, 30]);
    expect(bands.too_humid.presetId).toBe('flowering');
    expect(await db.alerts.findOne({ resolvedAt: null }).lean()).toMatchObject({ id: open!.id });
  });
});

/**
 * A place's thresholds follow every climate written there, by one way: the write of a device's settings
 * (`DeviceConfigurationService.store`), which a preset under Steuerung, a phase with its climate, the claim, a plan
 * step and a spell ended all go through. The phase sheet's "Blüte · jetzt" with Blüte over a grow recorded in Blüte, a
 * Steuerung preset and "Keimung beenden" each wrote a climate and left another stage's bands.
 */
describe('every climate written moves the place´s bands', () => {
  const OWNER = 'user-owner';
  const HIDE = { authors: false, counts: false, weights: false };
  const DOCUMENT = {
    workmode: 'small',
    day: { temperature: 25, humidity: 60 },
    night: { temperature: 20, humidity: 55 },
    daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 2700, targetHumidityDiff: 5, useLongHumidityAvg: 0, linearChange: 1 },
    co2: { target: 900, sunsetOff: 1 },
    lights: { limit: 80 },
  };
  const VEG = [18, 72, 31];
  const FLOWER = [16, 60, 30];
  const SEEDLING = [17, 80, 29];
  let configuration: DeviceConfigurationService;
  let grows: GrowsService;

  /** Too cold, too humid, too hot: the three figures the alarms page reads. */
  const bands = async (deviceId = DEVICE) => {
    const rules = await byKey(deviceId);
    return [rules.too_cold?.watch.lower, rules.too_humid?.watch.upper, rules.too_hot?.watch.upper];
  };
  const document = async () => (await db.devices.findOne({ id: DEVICE }).lean())!.configuration as Record<string, unknown>;
  /** "Übernehmen" on a chip of Steuerung's Klima-Preset: the whole document with the preset's figures, and its name. */
  const steuerung = async (stage: 'vegetative' | 'flowering' | 'seedling' | 'germination' | 'drying') => {
    const current = await document();
    return configuration.replace(
      DEVICE,
      { ...current, ...presetConfiguration(stage, null, current, true) },
      OWNER,
      stage === 'drying',
      stage === 'germination',
      undefined,
      { stage, preset: null },
    );
  };
  const aGrowInVeg = () =>
    db.grows.create({
      id: GROW,
      ownerId: OWNER,
      name: 'Einzelgrow',
      slug: 'einzelgrow',
      type: 'photoperiod',
      visibility: 'private',
      startedAt: new Date(Date.now() - 20 * 24 * 3600_000),
      endedAt: null,
      phases: [],
      placements: [{ id: 'pl1', spaceId: TENT, startedAt: new Date(Date.now() - 20 * 24 * 3600_000), endedAt: null, plantIds: null }],
    });

  beforeEach(async () => {
    ({ configuration } = deviceStackOn(db, null, { [STAGE_ALARMS]: service }));
    const writer = new EntryWriterService(db.entries);
    const phases = new PhaseWriterService(db.grows, writer, db.entries, db.devices, service);
    grows = growsOn(db, accessOn(db), { writer, phases, presets: new ClimatePresetsService(db.devices, configuration) });
    await db.devices.create([
      { id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: TENT, configuration: DOCUMENT },
      { id: OTHER, type: 'plug', ownerId: OWNER, spaceId: TENT },
      { id: 'device-elsewhere', type: 'controller', ownerId: OWNER, spaceId: 'space-other', configuration: DOCUMENT },
    ]);
  });

  it('writes the climate of the stage a grow already stands in, and its bands with it', async () => {
    await aGrowInVeg();
    await grows.addPhase(GROW, { stage: 'vegetative', climate: true }, OWNER, HIDE);
    expect(await bands()).toEqual(VEG);

    // Blüte recorded with "Lassen": no climate, no band.
    await grows.addPhase(GROW, { stage: 'flowering' }, OWNER, HIDE);
    expect(await bands()).toEqual(VEG);

    // "Blüte · jetzt" with Blüte: no phase begins, the climate is written, and every device of the place follows it.
    await grows.addPhase(GROW, { stage: 'flowering', climate: true }, OWNER, HIDE);
    expect(await bands()).toEqual(FLOWER);
    expect(await bands(OTHER)).toEqual(FLOWER);
    expect(await bands('device-elsewhere')).toEqual([undefined, undefined, undefined]);
    expect((await db.grows.findOne({ id: GROW }).lean())!.phases.map(phase => phase.stage)).toEqual(['vegetative', 'flowering']);
  });

  it('follows a preset taken under Steuerung, where no grow stands and where one stays in its stage', async () => {
    await steuerung('vegetative');
    expect(await bands()).toEqual(VEG);
    await steuerung('flowering');
    expect(await bands()).toEqual(FLOWER);
    expect(await bands(OTHER)).toEqual(FLOWER);

    await aGrowInVeg();
    await grows.addPhase(GROW, { stage: 'flowering' }, OWNER, HIDE);
    await steuerung('vegetative');
    expect(await bands()).toEqual(VEG);
    expect((await db.grows.findOne({ id: GROW }).lean())!.phases.map(phase => phase.stage)).toEqual(['flowering']);
  });

  it('follows a plan step´s stage with no grow there, and moves no band for a figure changed by hand', async () => {
    await configuration.applyConfiguration(DEVICE, { day: { temperature: 26 } }, 'flowering', undefined, null);
    expect(await bands()).toEqual(FLOWER);

    await configuration.replace(DEVICE, { ...(await document()), day: { temperature: 27, humidity: 70 } }, OWNER);
    expect(await bands()).toEqual(FLOWER);
  });

  /** "Widerrufen" in the preset's toast: the figures from before, the name they had, and the bands the save answered. */
  it('puts back the bands from before a preset taken back, or none where there were none', async () => {
    await steuerung('flowering');
    await configuration.replace(DEVICE, { ...(await document()), day: { temperature: 25, humidity: 52 } }, OWNER);
    const handMade = await document();

    const veg = await steuerung('vegetative');
    expect(veg.bandsBefore).toEqual({ stage: 'flowering', preset: null });
    expect(await bands()).toEqual(VEG);
    await configuration.replace(DEVICE, handMade, OWNER, undefined, undefined, undefined, undefined, veg.bandsBefore);
    expect(await bands()).toEqual(FLOWER);
    expect(await bands(OTHER)).toEqual(FLOWER);
    expect(await document()).toEqual(handMade);

    // A place that had no stage bands has none again.
    await db.alarmRules.deleteMany({ origin: 'preset' });
    const untouched = await document();
    const blüte = await steuerung('flowering');
    expect(blüte.bandsBefore).toBeNull();
    await configuration.replace(DEVICE, untouched, OWNER, undefined, undefined, undefined, undefined, blüte.bandsBefore);
    expect(await bands()).toEqual([undefined, undefined, undefined]);
    expect(await bands(OTHER)).toEqual([undefined, undefined, undefined]);
  });

  describe('a Grow-Plan step', () => {
    const NOW = new Date();
    /** The device's Grow-Plan, standing on one step, and the engine's pass at `now` (the device answering). */
    const planPass = async (planStep: Partial<PlanStep>, now = NOW, lastAppliedAt: Date | null = null) => {
      await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.lastSeenAt': now } });
      await db.plans.deleteMany({});
      await db.plans.create({
        id: 'plan-1',
        deviceId: DEVICE,
        templateId: null,
        name: 'Phasenplan',
        steps: [{ ...PLAN_STEP, ...planStep }],
        loop: false,
        notify: { mode: 'off', email: null, writeEntries: false },
        state: { status: 'running', activeStepIndex: 0, stepStartedAt: now, pausedElapsedMs: 0, lastAppliedAt },
      });
      const mail = { send: async () => undefined } as unknown as MailService;
      const phases = new PhaseWriterService(db.grows, new EntryWriterService(db.entries), db.entries, db.devices, service);
      const progress = new PlanProgressService(db.plans, db.devices, db.users, new EntryWriterService(db.entries), phases, mail);
      await new PlanEngineService(db.plans, db.devices, configuration, progress).run(now);
    };
    const named = async () => (await db.devices.findOne({ id: DEVICE }).lean())!.appliedClimate;

    it('that writes no figures moves no band and names nothing, after a preset or a phase´s climate', async () => {
      await steuerung('vegetative');
      await planPass({ stage: 'flowering', preset: 'autoflower' });
      expect(await bands()).toEqual(VEG);
      expect(await named()).toEqual({ stage: 'vegetative', preset: null });

      // The hourly re-send after a climate written since leaves that climate's bands.
      await aGrowInVeg();
      await grows.addPhase(GROW, { stage: 'vegetative', climate: true }, OWNER, HIDE);
      expect(await bands()).toEqual(VEG);
      await planPass({ stage: 'flowering' }, new Date(NOW.getTime() + 2 * 3600_000), NOW);
      expect(await bands()).toEqual(VEG);
      expect(await named()).toEqual({ stage: 'vegetative', preset: null });
    });

    it('that writes figures moves the bands to its climate, and a dark one with no figures to its stage', async () => {
      await steuerung('vegetative');
      await planPass({ stage: 'flowering', settings: { day: { humidity: 50 } } });
      expect(await bands()).toEqual(FLOWER);
      expect(await named()).toBeNull();

      await planPass({ stage: 'drying' });
      expect((await bands())[1]).toBe(68);
    });
  });

  it('ends a germination on the climate it came from, name and bands', async () => {
    await steuerung('seedling');
    await steuerung('germination');
    expect((await bands())[1]).toBe(90);

    // "Keimung beenden": its own button, no climate of its own.
    await configuration.configure(DEVICE, { mode: 'standard' }, OWNER);

    expect(await bands()).toEqual(SEEDLING);
    expect(await db.devices.findOne({ id: DEVICE }).lean()).toMatchObject({ appliedClimate: { stage: 'seedling', preset: null } });
  });

  it('ends a drying spell on the climate it came from, and keeps nothing aside once the figures are the grower´s', async () => {
    await steuerung('vegetative');
    await steuerung('drying');
    await configuration.configure(DEVICE, { drying: false }, OWNER);
    expect(await bands()).toEqual(VEG);

    await steuerung('drying');
    await configuration.replace(DEVICE, { ...(await document()), night: { temperature: 15, humidity: 60 } }, OWNER);
    await configuration.configure(DEVICE, { drying: false }, OWNER);
    expect((await bands())[1]).toBe(68);
    expect(await db.devices.findOne({ id: DEVICE }).lean()).toMatchObject({ appliedClimate: null });
  });
});
