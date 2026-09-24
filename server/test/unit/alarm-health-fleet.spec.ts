import { jest } from '@jest/globals';
import { Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule, alarmRulesSchema } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert, alertsSchema } from '@database/schemas/v1/alerts.schema';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { AlarmDeliveryService } from '@modules/alarm/alarm-delivery.service';
import { AlarmEngineService } from '@modules/alarm/alarm-engine.service';
import { AlarmHealthService } from '@modules/alarm/alarm-health.service';
import { AlertService } from '@modules/alarm/alert.service';
import { DataService, DeviceSince, NewestSamples } from '@modules/data/data.service';
import { FluxRow } from '@modules/data/flux';
import { MailService } from '@modules/mail/mail.service';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { V1TestDatabase, startV1TestDatabase } from './support/v1-database';

/**
 * The alarm health loop against a fleet the size of a real one, and against a
 * measurement store that is slow, refusing, or silent.
 *
 * This is the spec the outage that produced it asks for. The loop asked the
 * store one question about the whole quiet fleet at once, ranged back to the
 * oldest silence in it; on a restored production database that read never
 * returned, so the pass threw in its first line and everything after it - the
 * offline rule the cloud keeps for every device, the offline alarm, the
 * camera-stale alarm and the stale-warning backfill - had never run once, on
 * any device, in a hundred and seventy-five consecutive passes. Nothing on any
 * screen said so, because an install with no alarms raised looks exactly like
 * an install with nothing wrong.
 *
 * So what is checked here is a pass, at that size, with the store behaving
 * badly in each of the ways it did: the pass has to finish, it has to do the
 * work that needs no store at all, and it must not turn a store it could not
 * read into a verdict about a device. A spec of the query string would have
 * passed happily through all of it.
 */

const OWNER = 'user-owner';
const SPACE = 'space-1';

/** The restored database's own figures: 223 claimed devices, 218 of them past the offline window. */
const FLEET = 223;
const QUIET = 218;

/** Ten minutes of silence is what counts as gone. */
const GONE_MS = 11 * 60 * 1000;

let db: V1TestDatabase;
let rules: Model<StoredAlarmRule>;
let alerts: Model<StoredAlert>;
let health: AlarmHealthService;

/** Which devices the stand-in store declines to answer for, and when the rest last wrote. */
let refuses: Set<string>;
let spoke: Map<string, Date>;
let asked: DeviceSince[][];

const quietId = (index: number) => `device-quiet-${index}`;
const liveId = (index: number) => `device-live-${index}`;

/**
 * The fleet as the restored database holds it: most of it silent for anything
 * from four days to ten months, and a handful still reporting.
 */
const buildFleet = async (): Promise<void> => {
  const now = Date.now();
  await db.devices.insertMany([
    ...Array.from({ length: QUIET }, (_unused, index) => ({
      id: quietId(index),
      type: 'controller',
      ownerId: OWNER,
      spaceId: SPACE,
      // From eleven minutes to ten months, so that one read over the set would
      // have to reach back across the whole of it.
      state: { lastSeenAt: new Date(now - GONE_MS - index * 24 * 3600_000) },
    })),
    ...Array.from({ length: FLEET - QUIET }, (_unused, index) => ({
      id: liveId(index),
      type: 'controller',
      ownerId: OWNER,
      spaceId: SPACE,
      state: { lastSeenAt: new Date(now) },
    })),
  ]);
};

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
  refuses = new Set();
  spoke = new Map();
  asked = [];

  const mail = { send: async () => undefined } as unknown as MailService;
  const entries = new EntryWriterService(db.entries);
  const delivery = new AlarmDeliveryService(db.devices, entries, mail, {} as TunnelService, null);
  const data = {
    points: async () => [],
    outputPoints: async () => [],
    newestSamplesOf: async (ask: readonly DeviceSince[]): Promise<NewestSamples> => {
      asked.push(ask.map(one => ({ ...one })));

      return {
        spokeAt: new Map([...spoke].filter(([id]) => ask.some(one => one.deviceId === id) && !refuses.has(id))),
        unread: new Set(ask.map(one => one.deviceId).filter(id => refuses.has(id))),
      };
    },
  } as unknown as DataService;

  const episodes = new AlertService(alerts, entries, delivery, null);
  const engine = new AlarmEngineService(rules, db.devices, data, episodes);
  health = new AlarmHealthService(db.devices, rules, db.cameras, engine, episodes, data);
});

describe('a pass over a fleet the size of the one the loop failed on', () => {
  it('finishes, and keeps the offline rule for every claimed device, though the store answered for none of them', async () => {
    await buildFleet();
    refuses = new Set(Array.from({ length: QUIET }, (_unused, index) => quietId(index)));

    const pass = await health.run(new Date());

    expect(pass).toEqual({ devices: FLEET, unjudged: QUIET });
    // The rule upkeep needs no store at all, and is exactly what a pass that
    // died in its first read never reached.
    expect(await rules.countDocuments({ origin: 'always', 'watch.metric': 'offline' })).toBe(FLEET);
  });

  /**
   * The correction the store supplies can only ever shorten a silence, so
   * asserting one without it is asserting the longest silence the cloud can
   * imagine on the strength of not having looked.
   */
  it('calls no device gone that it could not ask the store about', async () => {
    await buildFleet();
    refuses = new Set(Array.from({ length: QUIET }, (_unused, index) => quietId(index)));

    await health.run(new Date());

    expect(await alerts.countDocuments({ kind: 'offline' })).toBe(0);
  });

  it('raises for the devices it could ask about, and leaves the ones it could not exactly as they stood', async () => {
    await buildFleet();
    // The store answers for all but the last twenty; of those it answers for,
    // three have written since the cloud's own note of them and are not gone.
    refuses = new Set(Array.from({ length: 20 }, (_unused, index) => quietId(QUIET - 1 - index)));
    for (const index of [0, 1, 2]) spoke.set(quietId(index), new Date());

    const pass = await health.run(new Date());

    expect(pass).toEqual({ devices: FLEET, unjudged: 20 });
    expect(await alerts.countDocuments({ kind: 'offline' })).toBe(QUIET - 20 - 3);
    for (const index of [0, 1, 2]) expect(await alerts.countDocuments({ deviceId: quietId(index) })).toBe(0);
    expect(await alerts.countDocuments({ deviceId: quietId(QUIET - 1) })).toBe(0);
  });

  /**
   * The backfill and the camera check come after the read in the pass, which is
   * how the outage was pinned: ten cameras out of ten still carried no
   * `staleWarning` at all, which only a pass that never got past its first
   * query explains.
   */
  it('fills in the stale-warning switch, and judges a camera whose controller it could read', async () => {
    await buildFleet();
    refuses = new Set(Array.from({ length: QUIET }, (_unused, index) => quietId(index)));
    // A camera of one of the devices that is still reporting, so nothing about
    // its controller is in doubt, written the old way without the switch.
    await db.cameras.collection.insertOne({
      id: 'camera-old',
      createdAt: new Date(),
      ownerId: OWNER,
      kind: 'terpcam_controller',
      name: 'Tent',
      deviceId: liveId(0),
      spaceId: SPACE,
      stillIntervalSeconds: 30,
      nightOff: false,
      maintenanceOff: false,
      removedAt: null,
      state: { lastStillAt: new Date(Date.now() - GONE_MS) },
    });

    await health.run(new Date());

    expect(await db.cameras.countDocuments({ staleWarning: { $exists: false } })).toBe(0);
    expect(await alerts.findOne({ kind: 'camera_stale' }).lean<StoredAlert>()).toMatchObject({ cameraId: 'camera-old', ruleId: null });
  });

  /** A store answering for the whole fleet: the alarm the install exists for, on every device that really is silent. */
  it('raises for the whole quiet fleet when the store answers for all of it', async () => {
    await buildFleet();

    const pass = await health.run(new Date());

    expect(pass).toEqual({ devices: FLEET, unjudged: 0 });
    expect(await alerts.countDocuments({ kind: 'offline' })).toBe(QUIET);
    expect(asked[0]).toHaveLength(QUIET);
  });

  it('notes a completed pass and clears the failures, and counts a failed one without losing the pass before it', async () => {
    await buildFleet();
    const tick = (health as unknown as { tick: () => Promise<void> }).tick.bind(health);

    await tick();
    const completed = health.health;
    expect(completed.last).toMatchObject({ devices: FLEET, unjudged: 0 });
    expect(completed.failures).toBe(0);

    // The database goes away under the loop, which is the shape every failure
    // of it takes: the pass throws and the tick counts it.
    const broken = jest.spyOn(db.devices, 'find').mockImplementation(() => {
      throw new Error('the database said no');
    });

    try {
      await expect(tick()).rejects.toThrow('the database said no');
    } finally {
      broken.mockRestore();
    }

    expect(health.health.last).toEqual(completed.last);
    expect(health.health.failures).toBe(1);
    expect(health.health.failedAt).toBeInstanceOf(Date);
  });
});

describe('what a fleet´s last words cost to read', () => {
  const fleetOf = (size: number): DeviceSince[] =>
    Array.from({ length: size }, (_unused, index) => ({ deviceId: quietId(index), since: new Date(Date.now() - GONE_MS - index * 24 * 3600_000) }));

  /** The real service, with only its talk to the store stood in for. */
  const storeThat = (answer: (query: string) => Promise<FluxRow[]>): DataService => {
    const store = new DataService(db.devices, { url: 'http://127.0.0.1:1', token: 'token', org: 'org', bucket: 'bucket' });
    (store as unknown as { read: (query: string) => Promise<FluxRow[]> }).read = answer;

    return store;
  };

  /**
   * The regression itself. One read for the set is what did not return, and it
   * is `contains()` that makes it so: the filter is not pushed down, so the
   * `last()` behind it is computed over every point of every series in the
   * bucket back to the start of the range - which for one read over the set has
   * to be the oldest silence on the install.
   */
  it('asks one read per device, each ranged from that device´s own last message, and never one read over the set', async () => {
    const queries: string[] = [];
    const store = storeThat(async query => {
      queries.push(query);
      return [];
    });
    const fleet = fleetOf(QUIET);

    await store.newestSamplesOf(fleet);

    expect(queries).toHaveLength(QUIET);
    for (const [index, one] of fleet.entries()) {
      const mine = queries.filter(query => query.includes(`r["device_id"] == "${one.deviceId}"`));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toContain(`range(start: ${one.since.toISOString()})`);
      // And never the oldest of everybody's, which is what widened the read.
      if (index < QUIET - 1) expect(mine[0]).not.toContain(fleet[QUIET - 1].since.toISOString());
    }
    expect(queries.filter(query => query.includes('contains('))).toEqual([]);
  });

  it('calls a device the store refused unread rather than silent, and goes on to the next', async () => {
    const store = storeThat(async query => {
      if (query.includes(quietId(3))) throw new Error('the store said no');
      return [{ _time: new Date().toISOString() } as FluxRow];
    });

    const answer = await store.newestSamplesOf(fleetOf(10));

    expect([...answer.unread]).toEqual([quietId(3)]);
    expect(answer.spokeAt.size).toBe(9);
  });

  /**
   * The outage's own shape: the store accepted the read and never answered it.
   * The client's timeout is a socket timeout and does not fire on a connection
   * that is busy, so nothing but the budget ends this.
   */
  it('comes back inside its budget when the store never answers, and calls every device it was waiting on unread', async () => {
    const store = storeThat(() => new Promise<FluxRow[]>(() => undefined));
    const started = Date.now();

    const answer = await store.newestSamplesOf(fleetOf(QUIET), 300);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(answer.spokeAt.size).toBe(0);
    expect(answer.unread.size).toBe(QUIET);
  });
});
