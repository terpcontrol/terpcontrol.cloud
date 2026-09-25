import { jest } from '@jest/globals';
import { Model } from 'mongoose';
import { OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { MAINTENANCE_SETTLE_SECONDS } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule, alarmRulesSchema } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert, alertsSchema } from '@database/schemas/v1/alerts.schema';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { AlarmDeliveryService } from '@modules/alarm/alarm-delivery.service';
import { AlarmEngineService } from '@modules/alarm/alarm-engine.service';
import { AlarmHealthService } from '@modules/alarm/alarm-health.service';
import { AlarmRuleService } from '@modules/alarm/alarm-rule.service';
import { AlertService } from '@modules/alarm/alert.service';
import { DataService, DeviceSince } from '@modules/data/data.service';
import { MailService } from '@modules/mail/mail.service';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { V1TestDatabase, startV1TestDatabase } from './support/v1-database';

/**
 * The state machine, against a real database: a rule and its state are one
 * document and an alert is one document from trigger to resolution, so what is
 * worth checking is that the two agree - one open alert per episode, the worst
 * reading on both, and nothing said while somebody is working on the tent.
 *
 * The health loop is the same machine asked about silence rather than about a
 * reading, and is checked here for that reason.
 */

const DEVICE = 'device-1';
const SPACE = 'space-1';
const OWNER = 'user-1';

/** Ten minutes of silence is what counts as gone. */
const GONE_MS = 11 * 60 * 1000;

let db: V1TestDatabase;
let rules: Model<StoredAlarmRule>;
let alerts: Model<StoredAlert>;
let engine: AlarmEngineService;
let health: AlarmHealthService;
let episodes: AlertService;
let mailed: string[];

/** What the measurement store answers a rule reading its own past back: set per case. */
let stored: SeriesPoint[];
let seriesReads: number;

/**
 * What the store answers when the health loop asks when a device last wrote
 * anything: empty unless a case says the device went on reporting after the
 * cloud's own note of it stopped being written, which is the migrated fleet.
 */
let heard: Map<string, Date>;
let heardAsked: DeviceSince[][];

/** Devices the store is to refuse to answer for, which is what a store that is slow or down looks like from the loop. */
let unread: string[];

/** A minute apart, oldest first, ending at `endingAt` - the shape `DataService` answers a window in. */
const series = (values: (number | null)[], endingAt: number = Date.now()): SeriesPoint[] =>
  values.map((value, index) => ({ measuredAt: new Date(endingAt - (values.length - 1 - index) * 60_000).toISOString(), value }));

const ruleFor = (over: Partial<StoredAlarmRule> = {}): StoredAlarmRule => ({
  id: 'rule-1',
  createdAt: new Date(),
  deviceId: DEVICE,
  name: 'Too warm',
  watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
  forSeconds: 0,
  severity: 'warning',
  origin: 'human',
  presetId: null,
  presetKey: null,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
  silencedUntil: null,
  state: { triggered: false, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: null, lastSampleAt: null },
  ...over,
});

const reads = (temperature: number, at: Date) => engine.onSample({ deviceId: DEVICE, measuredAt: at, values: { temperature }, outputs: {} });

/** The same message, read for what the controller was driving rather than for what it measured. */
const drives = (outputs: Partial<Record<OutputMetric, number>>, at: Date) =>
  engine.onSample({ deviceId: DEVICE, measuredAt: at, values: {}, outputs });

const storedRule = async (): Promise<StoredAlarmRule> => (await rules.findOne({ id: 'rule-1' }).lean<StoredAlarmRule>())!;

const openAlert = () => alerts.findOne({ resolvedAt: null }).lean<StoredAlert>();

const device = (over: Record<string, unknown> = {}) =>
  db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: SPACE, state: { lastSeenAt: new Date() }, ...over });

beforeAll(async () => {
  db = await startV1TestDatabase();
  rules = db.connection.model<StoredAlarmRule>(MODEL_V1.alarmRule, alarmRulesSchema);
  alerts = db.connection.model<StoredAlert>(MODEL_V1.alert, alertsSchema);
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  mailed = [];
  stored = [];
  seriesReads = 0;
  heard = new Map();
  heardAsked = [];
  unread = [];

  const mail = { send: async (message: { subject: string }) => void mailed.push(message.subject) } as unknown as MailService;
  const entries = new EntryWriterService(db.entries);
  const delivery = new AlarmDeliveryService(db.devices, entries, mail, {} as TunnelService, null);
  const answer = async () => {
    seriesReads += 1;
    return stored;
  };
  const newestSamplesOf = async (asked: readonly DeviceSince[]) => {
    heardAsked.push(asked.map(one => ({ ...one })));
    const answered = asked.filter(one => !unread.includes(one.deviceId)).map(one => one.deviceId);

    return {
      spokeAt: new Map([...heard].filter(([id]) => answered.includes(id))),
      unread: new Set(asked.map(one => one.deviceId).filter(id => unread.includes(id))),
    };
  };
  const data = { points: jest.fn(answer), outputPoints: jest.fn(answer), newestSamplesOf: jest.fn(newestSamplesOf) } as unknown as DataService;
  const alertService = new AlertService(alerts, entries, delivery, null);
  episodes = alertService;

  engine = new AlarmEngineService(rules, db.devices, data, alertService);
  health = new AlarmHealthService(db.devices, rules, db.cameras, engine, alertService, data);
});

describe('a reading leaving its band', () => {
  beforeEach(async () => {
    await device();
    await rules.create(ruleFor());
  });

  it('opens one alert and one entry, and holds the rule to it', async () => {
    await reads(32, new Date());

    const alert = await openAlert();
    expect(alert).toMatchObject({ ruleId: 'rule-1', deviceId: DEVICE, spaceId: SPACE, kind: 'threshold', severity: 'warning', value: 32 });
    expect((await storedRule()).state.triggered).toBe(true);

    const entries = await db.entries.find({}).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'alarm', source: 'alarm', alertId: alert!.id, severity: 'warning' });
    expect(entries[0].message?.key).toBe('message-alarm-triggered');
  });

  it('keeps the worst reading of the episode on the rule and on the alert', async () => {
    await reads(32, new Date(Date.now() - 2000));
    await reads(35, new Date(Date.now() - 1000));

    expect((await storedRule()).state.extremeValue).toBe(35);
    expect((await openAlert())?.extremeValue).toBe(35);
  });

  it('closes the alert when the reading comes back, and says what the worst of it was', async () => {
    await reads(35, new Date(Date.now() - 2000));
    await reads(25, new Date(Date.now() - 1000));

    expect(await openAlert()).toBeNull();
    const alert = await alerts.findOne({ ruleId: 'rule-1' }).lean<StoredAlert>();
    expect(alert?.resolvedAt).toBeInstanceOf(Date);
    expect(alert?.extremeValue).toBe(35);

    const rule = await storedRule();
    expect(rule.state.triggered).toBe(false);
    expect(rule.state.extremeValue).toBeNull();
    expect((await db.entries.find({}).lean()).map(entry => entry.message?.key)).toEqual(['message-alarm-triggered', 'message-alarm-resolved']);
  });

  it('opens no second alert while the first is open', async () => {
    await reads(32, new Date(Date.now() - 2000));
    await reads(33, new Date(Date.now() - 1000));

    expect(await alerts.countDocuments({})).toBe(1);
  });
});

describe('what keeps an alarm quiet', () => {
  it('says nothing while somebody is working on the tent', async () => {
    await device({ state: { lastSeenAt: new Date(), maintenanceUntil: new Date(Date.now() + 60_000) } });
    await rules.create(ruleFor());

    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
    expect((await storedRule()).state.triggered).toBe(false);
  });

  /**
   * The quiet outlasts the window by `MAINTENANCE_SETTLE_SECONDS`: a tent whose
   * heater has been off while somebody had their hands in it is not back at its
   * targets the second the door shuts. The app promises that span now, so the
   * span has to be the contract's own and not a number this file happens to
   * hold - a window that had only just run out still says nothing, and one that
   * ran out longer ago than the settling does.
   */
  it('goes on saying nothing for the settling the contract names, and speaks again after it', async () => {
    await device({ state: { lastSeenAt: new Date(), maintenanceUntil: new Date(Date.now() - 1_000) } });
    await rules.create(ruleFor());

    await reads(32, new Date());
    expect((await storedRule()).state.triggered).toBe(false);

    await db.devices.updateOne(
      { id: DEVICE },
      { $set: { 'state.maintenanceUntil': new Date(Date.now() - (MAINTENANCE_SETTLE_SECONDS + 60) * 1000) } },
    );
    await reads(32, new Date());

    expect((await storedRule()).state.triggered).toBe(true);
  });

  /**
   * The quiet has to cover the repeat as well as the turn, or it only holds for
   * an episode that has not started yet. A rule already triggered when the
   * window opens went on announcing itself every minute right through it, which
   * is the one case the window exists for: somebody steps into a tent that is
   * already complaining. What is watched here is the rule's own
   * `lastTriggeredAt`, because that instant moves for a repeat and for nothing
   * else once the episode is open - and it moves again on the first sample after
   * the quiet has run out, because the tent is still wrong and nobody has been
   * told since.
   */
  it('holds the repeat of an episode that was already open, and repeats again once the quiet is over', async () => {
    const announcedAt = new Date(Date.now() - 120_000);
    await device({ state: { lastSeenAt: new Date(), maintenanceUntil: new Date(Date.now() + 60_000) } });
    await rules.create(
      ruleFor({
        repeatSeconds: 60,
        state: { triggered: true, lastTriggeredAt: announcedAt, lastResolvedAt: null, extremeValue: 32, lastSampleAt: null },
      }),
    );

    await reads(32, new Date());
    expect((await storedRule()).state.lastTriggeredAt).toEqual(announcedAt);

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.maintenanceUntil': null } });
    await reads(32, new Date(Date.now() + 1_000));

    expect((await storedRule()).state.lastTriggeredAt!.getTime()).toBeGreaterThan(announcedAt.getTime());
  });

  it('says the all-clear once, rather than repeating it for as long as nothing goes wrong', async () => {
    const clearedAt = new Date(Date.now() - 120_000);
    await device();
    await rules.create(
      ruleFor({
        repeatSeconds: 60,
        state: {
          triggered: false,
          lastTriggeredAt: new Date(Date.now() - 600_000),
          lastResolvedAt: clearedAt,
          extremeValue: null,
          lastSampleAt: null,
        },
      }),
    );

    await reads(25, new Date());

    expect((await storedRule()).state.lastResolvedAt).toEqual(clearedAt);
  });

  it('repeats an e-mail while the alarm lasts, but never sooner than five minutes after the last one', async () => {
    const mailRule = (lastTriggeredAt: Date) =>
      ruleFor({
        repeatSeconds: 60,
        delivery: { mode: 'custom', custom: { channel: 'email', target: 'somebody@example.com', includeDetails: false, webhook: null } },
        state: { triggered: true, lastTriggeredAt, lastResolvedAt: null, extremeValue: 32, lastSampleAt: null },
      });
    await device();
    await alerts.create({
      id: 'alert-1',
      createdAt: new Date(),
      ruleId: 'rule-1',
      deviceId: DEVICE,
      cameraId: null,
      spaceId: SPACE,
      kind: 'threshold',
      severity: 'warning',
      startedAt: new Date(Date.now() - 600_000),
      resolvedAt: null,
      value: 32,
      extremeValue: 32,
      watched: null,
    });

    await rules.create(mailRule(new Date(Date.now() - 120_000)));
    await reads(32, new Date());
    expect(mailed).toEqual([]);

    await rules.deleteMany({});
    await rules.create(mailRule(new Date(Date.now() - 360_000)));
    await reads(32, new Date(Date.now() + 1_000));
    expect(mailed).toEqual(['[TERP CONTROL] Alarm Too warm triggered for Device device-1']);
  });

  it('waits out the cooldown before triggering again', async () => {
    await device();
    await rules.create(ruleFor({ cooldownSeconds: 600, state: { ...ruleFor().state, lastTriggeredAt: new Date(), lastResolvedAt: new Date() } }));

    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
  });

  it('leaves a disabled rule alone', async () => {
    await device();
    await rules.create(ruleFor({ enabled: false }));

    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
  });

  it('records a silenced rule without sending anything', async () => {
    await device();
    await rules.create(
      ruleFor({
        silencedUntil: new Date(Date.now() + 60_000),
        delivery: { mode: 'custom', custom: { channel: 'email', target: 'somebody@example.com', includeDetails: true, webhook: null } },
      }),
    );

    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(1);
    expect(mailed).toEqual([]);
  });
});

describe('a rule on an output', () => {
  it('trips on the output running at all, and lets go when it stops', async () => {
    await device();
    await rules.create(ruleFor({ name: 'Fridge never stops', watch: { kind: 'output_running', output: 'dehumidifier' } }));

    await drives({ dehumidifier: 1 }, new Date(Date.now() - 2000));

    const alert = await openAlert();
    expect(alert).toMatchObject({ ruleId: 'rule-1', deviceId: DEVICE, kind: 'threshold', value: 1 });
    expect((await storedRule()).state.triggered).toBe(true);

    await drives({ dehumidifier: 0 }, new Date(Date.now() - 1000));

    expect(await openAlert()).toBeNull();
    // Running is running: there is no worse reading to keep than the one that
    // opened it, which is what the old alarm on a compressor always recorded.
    expect((await alerts.findOne({ ruleId: 'rule-1' }).lean<StoredAlert>())?.extremeValue).toBe(1);
  });

  it('trips on an output leaving its band, in the numbers the series carries', async () => {
    await device();
    await rules.create(ruleFor({ name: 'Heater working too hard', watch: { kind: 'output_level', output: 'heater', upper: 0.8, lower: null } }));

    await drives({ heater: 0.5 }, new Date(Date.now() - 3000));
    expect(await alerts.countDocuments({})).toBe(0);

    await drives({ heater: 0.95 }, new Date(Date.now() - 2000));
    expect(await openAlert()).toMatchObject({ ruleId: 'rule-1', value: 0.95 });

    await drives({ heater: 1 }, new Date(Date.now() - 1000));
    expect((await storedRule()).state.extremeValue).toBe(1);
  });

  it('is left alone by a message that says nothing about its output', async () => {
    await device();
    await rules.create(ruleFor({ watch: { kind: 'output_running', output: 'light' } }));

    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
    expect((await storedRule()).state.lastSampleAt).toBeNull();
  });
});

/**
 * A patient rule is the one an in-memory clock cannot answer on its own: the
 * engine is a fresh one in every case here, which is what a restart leaves
 * behind, and the only thing that remembers the episode is the stored series.
 *
 * The eleven fridge alarms the migration brought over are exactly this shape -
 * "the compressor has not stopped in an hour" - so a clock that starts again
 * with the server is an alarm that a continuously running fridge never raises.
 */
describe('a rule that waits', () => {
  /** An hour of the compressor running, which is the episode the rule is there for. */
  const anHourOfRunning = () => {
    stored = series(Array.from({ length: 65 }, () => 1));
  };

  const patientRule = (over: Partial<StoredAlarmRule> = {}) =>
    rules.create(ruleFor({ name: 'Fridge never stops', watch: { kind: 'output_running', output: 'dehumidifier' }, forSeconds: 3600, ...over }));

  beforeEach(async () => {
    await device();
  });

  it('triggers on the first sample after a restart when the series says the hour is already up', async () => {
    anHourOfRunning();
    await patientRule();

    await drives({ dehumidifier: 1 }, new Date());

    expect(seriesReads).toBe(1);
    expect(await openAlert()).toMatchObject({ ruleId: 'rule-1', value: 1 });
  });

  it('starts the hour again where the series says the output stopped in the meantime', async () => {
    stored = series([1, 1, 1, 0, 1, 1]);
    await patientRule();

    await drives({ dehumidifier: 1 }, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
  });

  it('starts the hour now where the series holds nothing to read', async () => {
    stored = [];
    await patientRule();

    await drives({ dehumidifier: 1 }, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
  });

  it('reads its past back once and then watches for itself', async () => {
    anHourOfRunning();
    await patientRule({ cooldownSeconds: 3600 });

    await drives({ dehumidifier: 1 }, new Date(Date.now() - 2000));
    await drives({ dehumidifier: 1 }, new Date(Date.now() - 1000));

    expect(seriesReads).toBe(1);
  });

  it('counts from the last reading this process saw inside the band', async () => {
    await rules.create(ruleFor({ forSeconds: 60 }));

    await reads(20, new Date(Date.now() - 20 * 60 * 1000));
    await reads(32, new Date(Date.now() - 19 * 60 * 1000));

    // Twenty minutes inside, then outside: the hour-old reading is what the
    // duration is counted from, and nothing was read back for it.
    expect(seriesReads).toBe(0);
    expect(await openAlert()).toMatchObject({ ruleId: 'rule-1', value: 32 });
  });

  it('leaves an episode that is already open alone, however little the series reaches back', async () => {
    // A minute of running, which is a fraction of the hour the rule waits for:
    // the episode was opened before the restart and is not over.
    stored = series([1, 1]);
    await patientRule({ state: { ...ruleFor().state, triggered: true, extremeValue: 1, lastTriggeredAt: new Date(Date.now() - 3 * 3600_000) } });

    await drives({ dehumidifier: 1 }, new Date());

    expect((await storedRule()).state.triggered).toBe(true);
    expect(await alerts.countDocuments({})).toBe(0);
    // The duration was answered when it triggered; nothing is read back for it.
    expect(seriesReads).toBe(0);
  });

  it('starts the duration again across a gap, because a device that was away held nothing', async () => {
    await rules.create(ruleFor({ forSeconds: 60 }));

    await reads(20, new Date(Date.now() - 20 * 60 * 1000));
    await reads(32, new Date());

    expect(await alerts.countDocuments({})).toBe(0);
    // The gap answers it; the stored series is not asked about a device that
    // was demonstrably not reporting.
    expect(seriesReads).toBe(0);
  });
});

describe('the health loop', () => {
  it('keeps an offline rule for every claimed device and raises when one goes quiet', async () => {
    await device({ state: { lastSeenAt: new Date(Date.now() - GONE_MS) } });

    await health.run(new Date());

    const kept = await rules.findOne({ deviceId: DEVICE, 'watch.metric': 'offline' }).lean<StoredAlarmRule>();
    expect(kept).toMatchObject({ origin: 'always', enabled: true });
    expect(await openAlert()).toMatchObject({ kind: 'offline', ruleId: kept!.id, deviceId: DEVICE });
  });

  it('closes it when the device is heard from again', async () => {
    await device({ state: { lastSeenAt: new Date(Date.now() - GONE_MS) } });
    await health.run(new Date());

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.lastSeenAt': new Date() } });
    await health.run(new Date(Date.now() + 1000));

    expect(await openAlert()).toBeNull();
  });

  /**
   * The migrated fleet: the old cloud recorded a last connection and the
   * devices went on writing samples for another half day, so the note on the
   * document is older than the truth and a silence counted from it is longer
   * than the account's own stored readings show.
   */
  it('counts the silence from a stored reading that is newer than the note on the device', async () => {
    const at = new Date();
    await device({ state: { lastSeenAt: new Date(at.getTime() - 4 * 24 * 3600_000 - 13 * 3600_000) } });
    heard.set(DEVICE, new Date(at.getTime() - 4 * 24 * 3600_000 - 90 * 60_000));

    await health.run(at);

    expect(await openAlert()).toMatchObject({ kind: 'offline', value: 4 * 24 * 3600 + 90 * 60 });
    expect((await db.entries.find({}).lean()).map(entry => entry.message?.params[0])).toEqual(['Device offline, last heard 4 d 1 h ago']);
  });

  it('calls no device gone that the store heard from since the note was written', async () => {
    const at = new Date();
    await device({ state: { lastSeenAt: new Date(at.getTime() - GONE_MS) } });
    heard.set(DEVICE, new Date(at.getTime() - 60_000));

    await health.run(at);

    expect(await alerts.countDocuments({})).toBe(0);
  });

  /**
   * The quiet half of the fleet is asked about and the rest is not: a reading
   * can only shorten a silence, so a device the note still calls present has
   * no answer the store could change. Each of them is asked from its own last
   * message, which is the only instant that can answer anything about it - and
   * is what keeps a read off the whole bucket back to the oldest silence on the
   * install.
   */
  it('asks the store only about the devices the note already calls gone, each from its own last message', async () => {
    const seen = new Date(Date.now() - GONE_MS);
    await device({ state: { lastSeenAt: seen } });
    await db.devices.create({ id: 'device-2', type: 'controller', ownerId: OWNER, spaceId: SPACE, state: { lastSeenAt: new Date() } });

    await health.run(new Date());

    expect(heardAsked).toEqual([[{ deviceId: DEVICE, since: seen }]]);
  });

  it('raises for a camera that has stopped delivering stills', async () => {
    await device();
    await db.cameras.create({
      id: 'camera-1',
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Tent',
      deviceId: DEVICE,
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      state: { lastStillAt: new Date(Date.now() - GONE_MS) },
    });

    await health.run(new Date());

    expect(await alerts.findOne({ kind: 'camera_stale' }).lean<StoredAlert>()).toMatchObject({ cameraId: 'camera-1', ruleId: null });
  });

  /**
   * The stale warning is opted out of, never into. What matters is what a
   * camera nobody has said anything about does - including one written before
   * the switch existed, which carries no value for it at all.
   */
  it('warns about a camera that predates the switch, and fills the switch in', async () => {
    await device();
    await db.cameras.collection.insertOne({
      id: 'camera-old',
      createdAt: new Date(),
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Carried over',
      deviceId: DEVICE,
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      nightOff: false,
      maintenanceOff: false,
      removedAt: null,
      state: { lastStillAt: new Date(Date.now() - GONE_MS) },
    });

    await health.run(new Date());

    expect(await alerts.countDocuments({ kind: 'camera_stale' })).toBe(1);
    expect((await db.cameras.findOne({ id: 'camera-old' }).lean())?.staleWarning).toBe(true);
  });

  it('says nothing about a camera whose warning has been switched off', async () => {
    await device();
    await db.cameras.create({
      id: 'camera-1',
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Tent',
      deviceId: DEVICE,
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      staleWarning: false,
      state: { lastStillAt: new Date(Date.now() - GONE_MS) },
    });

    await health.run(new Date());

    expect(await alerts.countDocuments({ kind: 'camera_stale' })).toBe(0);
  });

  it('says nothing about a camera whose controller is itself away', async () => {
    await device({ state: { lastSeenAt: new Date(Date.now() - GONE_MS) } });
    await db.cameras.create({
      id: 'camera-1',
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Tent',
      deviceId: DEVICE,
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      state: { lastStillAt: new Date(Date.now() - GONE_MS) },
    });

    await health.run(new Date());

    expect(await alerts.countDocuments({ kind: 'camera_stale' })).toBe(0);
  });
});

/**
 * The words the diary gets. An alarm's line is composed here rather than in the
 * catalogue, so what it says about silence is only ever as good as this - and
 * the seconds the health loop measures a silence in are not a figure anybody
 * reads, while the same number is drawn on the alert card as "last heard 4 d
 * ago".
 */
describe('the line an alarm writes into the diary', () => {
  const said = async (): Promise<string[]> => (await db.entries.find({}).sort({ createdAt: 1 }).lean()).map(entry => entry.message?.params[0] ?? '');

  it('says when a device was last heard rather than how many seconds ago that is', async () => {
    const quietSince = new Date(Date.now() - 374_021_218);
    await device({ state: { lastSeenAt: quietSince } });

    await health.run(new Date());

    expect(await said()).toEqual(['Device offline, last heard 4 d 7 h ago']);
  });

  it('says the same for a camera that has stopped delivering stills, which has no rule to name it', async () => {
    await device();
    await db.cameras.create({
      id: 'camera-1',
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Fridgegrow',
      deviceId: DEVICE,
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      state: { lastStillAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    await health.run(new Date());

    expect(await said()).toEqual(['Fridgegrow, last heard 2 h ago']);
  });

  it('dates the end of an absence from the episode rather than from the silence it was resolved on', async () => {
    const subject = {
      name: 'Device offline',
      kind: 'offline' as const,
      severity: 'critical' as const,
      rule: null,
      deviceId: DEVICE,
      cameraId: null,
      spaceId: SPACE,
    };
    const startedAt = new Date(Date.now() - 90 * 60 * 1000);

    const alert = await episodes.raise(subject, 660, startedAt);
    // What the loop hands the resolution is a fresh reading of the silence, and
    // by then the device has just spoken: the episode is the hour and a half,
    // not the twelve seconds that ended it.
    await episodes.settle(subject, alert, 12, new Date());

    expect(await said()).toEqual(['Device offline, last heard 11 min ago', 'Device offline, back after 1 h 30 min']);
  });

  it('leaves a threshold alarm in the words it has always used', async () => {
    await device();
    await rules.create(ruleFor());

    await reads(32, new Date());

    expect(await said()).toEqual(['Too warm (temperature), value=32, upper threshold=30, lower threshold=n/a']);
  });
});

/**
 * What an episode keeps of the rule that raised it: the rule's name and watch as
 * they stood when it opened, so that editing the rule afterwards or deleting it
 * cannot change or erase what the record says it was about.
 *
 * The episodes of a deleted rule stay. An alert is the account of something that
 * really happened in somebody's tent, and deleting the rule that caught it is not
 * a statement that it did not happen - so the delete closes the one episode still
 * open and leaves the record standing, able to say what it watched.
 */
describe('what an episode keeps of the rule that raised it', () => {
  const ruleService = () => new AlarmRuleService(rules, alerts);

  /**
   * The copy is taken as the episode opens and is never rewritten by an edit:
   * a band moved while the episode is still open is today's rule, and the
   * episode was raised against yesterday's.
   */
  it('keeps the band an episode was raised against when the rule is moved while it is open', async () => {
    await device();
    const rule = ruleFor({ name: 'Too warm' });
    await rules.create(rule);

    await reads(32, new Date());
    const raised = (await openAlert())!;
    expect(raised.watched).toMatchObject({ name: 'Too warm', watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null } });

    await ruleService().update(rule, { watch: { kind: 'reading', metric: 'temperature', upper: 60, lower: null } });

    const kept = (await alerts.findOne({ id: raised.id }).lean<StoredAlert>())!;
    expect(kept.watched).toMatchObject({ watch: { upper: 30 } });
  });

  it('leaves its episode behind, closes it, and leaves it able to say what it watched', async () => {
    await device();
    const rule = ruleFor({ name: 'Too warm' });
    await rules.create(rule);

    await reads(32, new Date());
    const raised = (await openAlert())!;

    await ruleService().remove(rule);

    const left = (await alerts.findOne({ id: raised.id }).lean<StoredAlert>())!;
    expect(left.resolvedAt).toBeInstanceOf(Date);
    expect(left.watched).toMatchObject({ name: 'Too warm', watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null } });
  });

  /**
   * An episode raised before the copy was written down carries none, and once
   * the rule is gone there is nowhere left to get one. The rule's last word on
   * the way out is not quite the episode's own - a band may have moved since -
   * but it names the right rule and the right metric, which is the whole
   * difference between a card reading "temperature 32 °C › 30" and one reading
   * "alarm 32".
   */
  it('gives an older episode the last word of its rule on the way out, rather than leaving it about nothing', async () => {
    await device();
    const rule = ruleFor({ name: 'Too warm' });
    await rules.create(rule);

    await reads(32, new Date());
    const raised = (await openAlert())!;
    await alerts.updateOne({ id: raised.id }, { $set: { watched: null } });

    await ruleService().remove(rule);

    const left = (await alerts.findOne({ id: raised.id }).lean<StoredAlert>())!;
    expect(left.watched).toMatchObject({ name: 'Too warm', watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null } });
  });
});
