import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, mongo } from 'mongoose';
import { MigrationRunner } from '@/migrations/migration-runner';
import { PreflightFailure, formatPreflight, preflight } from '@/migrations/preflight';
import { LEGACY_DEVICE_IDS, LEGACY_USER_IDS, LegacyDatabase, seedLegacyDatabase } from '../fixtures/legacy-database';

/**
 * What the migration refuses to start on, over the same database in today's
 * shapes the migration spec beside this one transforms.
 *
 * The fixture is the *clean* database and stays that way: every broken row is
 * added here, one per claim, because what is asserted is that a run finds all of
 * them at once and writes nothing while it does. A real MongoDB rather than a
 * stub - every check is an aggregation, and a stub would only confirm that this
 * spec and the pipeline agree on what to stub.
 */

const AT = Date.UTC(2026, 8, 17);

let server: MongoMemoryServer;
let connection: Connection;
let fixture: LegacyDatabase;

const db = (): mongo.Db => connection.db!;
const collection = (name: string) => db().collection(name);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  connection = mongoose.createConnection(server.getUri('preflight-spec'));
  await connection.asPromise();
});

afterAll(async () => {
  await connection?.dropDatabase();
  await connection?.close();
  await server?.stop();
});

beforeEach(async () => {
  for (const existing of await db().collections()) await existing.drop();
  fixture = await seedLegacyDatabase(connection, AT);
});

/** Inserts one broken row and answers the `_id` the report has to name it by. */
const insert = async (name: string, document: mongo.Document): Promise<string> => {
  const id = new mongo.ObjectId();
  await collection(name).insertOne({ ...document, _id: id });
  return id.toHexString();
};

const check = async (): Promise<string> => formatPreflight(await preflight(db()));

const problems = async (): Promise<string[]> => (await preflight(db())).problems.map(problem => problem.what);

/** Every collection with what is in it, so a check can be held to reading. */
const shape = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const name of (await db().listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort()) {
    counts[name] = await collection(name).countDocuments();
  }
  return counts;
};

const account = (userId: string, username: string): mongo.Document => ({ username, password: 'hash', user_id: userId, is_active: true });

const device = (deviceId: string, over: mongo.Document = {}): mongo.Document => ({
  device_id: deviceId,
  username: `mqtt-${deviceId}`,
  password: 'hash',
  owner_id: LEGACY_USER_IDS.ada,
  device_type: 'controller',
  ...over,
});

describe('a database that can carry the transforms', () => {
  it('finds nothing in the fixture and lets the run go on', async () => {
    expect(await problems()).toEqual([]);
    expect((await preflight(db())).rows).toBe(0);
  });

  it('writes nothing while it reads', async () => {
    const before = await shape();
    await preflight(db());
    expect(await shape()).toEqual(before);
  });
});

describe('the two the migration died on', () => {
  it('names both accounts that share a user_id, with what tells them apart', async () => {
    const clone = await insert('users', account(LEGACY_USER_IDS.ada, 'ada-two@example.test'));

    const report = await check();
    expect(report).toContain('Two or more accounts share one user_id.');
    expect(report).toContain(`user_id ${LEGACY_USER_IDS.ada}`);
    expect(report).toContain(clone);
    expect(report).toContain('"ada@example.test"');
    // What the decision turns on: the addresses, the dates, and how much each
    // account answers for.
    expect(report).toMatch(/owns 3 devices/u);
  });

  it('names accounts that share an address even where only the case or the spaces differ', async () => {
    const shouting = await insert('users', account('user-ada-shouting', '  ADA@Example.test '));

    const report = await check();
    expect(report).toContain('Two or more accounts share one e-mail address.');
    expect(report).toContain('e-mail ada@example.test');
    expect(report).toContain(shouting);
    // Quoted, so the space that a unique index does not forgive can be seen.
    expect(report).toContain('"  ADA@Example.test "');
  });
});

describe('everything else a transform cannot survive', () => {
  it('finds two devices under one device_id', async () => {
    const clone = await insert('devices', device(LEGACY_DEVICE_IDS.controller, { username: 'mqtt-second-tent', name: 'Tent, again' }));

    const report = await check();
    expect(report).toContain('Two or more devices share one device_id.');
    expect(report).toContain(clone);
    expect(report).toContain('Tent, again');
  });

  it('finds two devices under one broker username', async () => {
    const clone = await insert('devices', device('dev-impostor', { username: `mqtt-${LEGACY_DEVICE_IDS.controller}` }));

    const report = await check();
    expect(report).toContain('Two or more devices share one broker username.');
    expect(report).toContain(`MQTT username mqtt-${LEGACY_DEVICE_IDS.controller}`);
    expect(report).toContain(clone);
  });

  it('finds one claim code handed to two devices, and two codes for one device', async () => {
    const reused = await insert('claimcodes', { claim_code: fixture.claimCodes.forLightDevice, device_id: LEGACY_DEVICE_IDS.fan });
    const second = await insert('claimcodes', { claim_code: 'CLAIM-LIGHT-02', device_id: LEGACY_DEVICE_IDS.light });

    const report = await check();
    expect(report).toContain('Two or more claim code rows share one code.');
    expect(report).toContain('A device has more than one claim code.');
    expect(report).toContain(reused);
    expect(report).toContain(second);
  });

  it('finds two firmware files under one name of one build', async () => {
    const clone = await insert('devicefirmwarebinaries', {
      firmware_id: fixture.firmwares.stable,
      name: 'firmware.bin',
      data: Buffer.from('a different image altogether'),
    });

    const report = await check();
    expect(report).toContain('Two or more firmware files share one name under one build.');
    expect(report).toContain(`${fixture.firmwares.stable} / firmware.bin`);
    expect(report).toContain(clone);
    expect(report).toContain('28 bytes');
  });

  it('finds two pictures of one camera at one instant', async () => {
    const still = await collection('images').findOne({ image_id: fixture.images.stills[0] });
    const { _id: _dropped, ...copied } = still as mongo.Document;
    const clone = await insert('images', { ...copied, image_id: 'img-still-tent-1-again' });

    const report = await check();
    expect(report).toContain('Two or more pictures of one camera share an instant.');
    expect(report).toContain(clone);
    expect(report).toContain('"img-still-tent-1-again"');
  });

  it('finds a device and a plan template owned by an account that is not there', async () => {
    const orphan = await insert('devices', device('dev-orphaned', { owner_id: 'user-deleted-long-ago', name: 'Nobody’s tent' }));
    const template = await insert('recipetemplates', { name: 'Left behind', owner_id: 'user-deleted-long-ago', public: false, steps: [] });

    const report = await check();
    expect(report).toContain('A device is claimed by an account that is not in the database.');
    expect(report).toContain('A plan template is owned by an account that is not in the database.');
    expect(report).toContain('owner_id "user-deleted-long-ago"');
    expect(report).toContain(orphan);
    expect(report).toContain(template);
  });

  it('counts an account the transform would drop as one that is not there', async () => {
    // No password: it cannot sign in and the transform drops it, so a device
    // claimed by it is a device nobody owns.
    await insert('users', { username: 'ghost@example.test', user_id: 'user-ghost' });
    const orphan = await insert('devices', device('dev-ghost-owned', { owner_id: 'user-ghost' }));

    expect(await check()).toContain(orphan);
  });
});

describe('a run against a database that cannot carry it', () => {
  it('reports every problem rather than the first, and counts them', async () => {
    await insert('users', account(LEGACY_USER_IDS.ada, 'ada-two@example.test'));
    await insert('users', account('user-ben-again', 'BEN@example.test'));
    await insert('devices', device(LEGACY_DEVICE_IDS.fridge, { username: 'mqtt-second-fridge' }));

    const found = await preflight(db());
    expect(found.problems.map(problem => problem.what)).toEqual([
      'Two or more accounts share one user_id.',
      'Two or more accounts share one e-mail address.',
      'Two or more devices share one device_id.',
    ]);

    const report = formatPreflight(found);
    expect(report).toContain('1. Two or more accounts share one user_id.');
    expect(report).toContain('3. Two or more devices share one device_id.');
    // Every problem says what it breaks, and the tail says how much there is.
    expect(report.match(/ {3}Breaks: /gu)).toHaveLength(3);
    expect(report).toContain('3 problems, 6 rows in total.');
  });

  it('stops the run before anything is renamed aside or recorded', async () => {
    await insert('users', account(LEGACY_USER_IDS.ada, 'ada-two@example.test'));
    const before = await shape();

    await expect(new MigrationRunner(connection).run({ dryRun: false })).rejects.toThrow(PreflightFailure);

    expect(await shape()).toEqual(before);
    expect(Object.keys(before).filter(name => name.startsWith('legacy_'))).toEqual([]);
  });

  it('stops a dry run as well, because a rehearsal that skipped the checks would rehearse the wrong thing', async () => {
    await insert('devices', device(LEGACY_DEVICE_IDS.plug, { username: 'mqtt-second-plug' }));

    await expect(new MigrationRunner(connection).run({ dryRun: true })).rejects.toThrow(/share one device_id/u);
  });
});
