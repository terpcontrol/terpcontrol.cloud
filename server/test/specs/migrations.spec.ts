import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Db, MongoClient } from 'mongodb';
import { LegacyDatabase, seedLegacyDatabase } from '../fixtures/legacy-database';
import { context } from '../support/api';

/**
 * The migration as an operator runs it: `npm run migrate`, its dry run and its
 * rollback, against a database of its own on the MongoDB the suite already has.
 *
 * Black box like every spec here - it spawns the command, reads what it printed
 * and looks at the database afterwards, and imports nothing of the server. What
 * each transform makes of each old shape is `test/unit/migrations.spec.ts`,
 * which calls the runner directly; this is the command, its report and the state
 * it leaves behind.
 */

const SERVER_ROOT = join(__dirname, '..', '..');

/** Its own database, so nothing here touches the one the server under test is serving from. */
const DATABASE = 'migration-command-spec';

/** The instant the fixture is dated against; a constant, so a failure names a document that can be found. */
const AT = Date.UTC(2026, 8, 17);

const entryPoint = () =>
  process.env.HARNESS_BUILT === '1'
    ? { script: 'dist/migrations/cli.js', nodeArgs: [] as string[] }
    : { script: 'src/migrations/cli.ts', nodeArgs: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'] };

interface Outcome {
  code: number | null;
  output: string;
}

const migrate = (...args: string[]): Promise<Outcome> => {
  const entry = entryPoint();
  const child = spawn('node', [...entry.nodeArgs, entry.script, ...args], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...context.appEnv, DB_DATABASE: DATABASE },
  });

  let output = '';
  child.stdout.on('data', chunk => (output += String(chunk)));
  child.stderr.on('data', chunk => (output += String(chunk)));

  return new Promise<Outcome>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
};

let client: MongoClient;
let database: Db;
let fixture: LegacyDatabase;

const names = async (): Promise<string[]> => (await database.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort();

beforeAll(async () => {
  client = new MongoClient(context.mongoUri);
  await client.connect();
  database = client.db(DATABASE);
});

afterAll(async () => {
  await database?.dropDatabase();
  await client?.close();
});

beforeEach(async () => {
  await database.dropDatabase();
  fixture = await seedLegacyDatabase(database, AT);
});

describe('the migration command', () => {
  it('reads the whole database on a dry run and writes nothing at all', async () => {
    const before = await names();
    const { code, output } = await migrate('--dry-run', '--allow-rejects');

    expect(code).toBe(0);
    expect(output).toContain('Dry run: nothing was written.');
    expect(output).toContain(`users.written: ${fixture.counts.users}`);
    expect(output).toContain(`media.written: ${fixture.counts.images}`);

    expect(await names()).toEqual(before);
    expect(await database.collection('migrations').countDocuments()).toBe(0);
  }, 60_000);

  it('stops at the row it could not take, and says which one it was', async () => {
    const { code, output } = await migrate();

    expect(code).toBe(1);
    expect(output).toMatch(/could not take 2 rows, and the run stopped there/u);
    expect(output).toMatch(/devicefirmwarebinaries/u);
    expect(output).toMatch(/claimcodes\/CLAIM-ORPHAN-01/u);
    // Nothing of what follows that step has run.
    expect(await database.collection('entries').countDocuments()).toBe(0);
  }, 120_000);

  it('migrates the database, reports what it could not take, and has nothing left to do the second time', async () => {
    const first = await migrate('--allow-rejects');

    expect(first.code).toBe(0);
    expect(first.output).toContain('Migrations applied.');
    // Every reject an operator reads before letting the server back in, with
    // the ones that were kept told apart from the ones that were dropped.
    expect(first.output).toMatch(/dropped claimcodes\/CLAIM-ORPHAN-01/u);
    expect(first.output).toMatch(new RegExp(`kept devices/${fixture.devices.fan}`, 'u'));

    expect(await database.collection('spaces').countDocuments()).toBe(5);
    expect(await database.collection('entries').countDocuments()).toBe(fixture.counts.devicelogs);
    expect(await database.collection('legacy_devicelogs').countDocuments()).toBe(fixture.counts.devicelogs);

    const second = await migrate('--allow-rejects');

    expect(second.code).toBe(0);
    expect(second.output).toContain('Already applied:');
    expect(second.output).toContain('Nothing to do.');
  }, 120_000);

  it('puts the old collections back on a rollback, and takes the new ones away', async () => {
    await migrate('--allow-rejects');
    const { code, output } = await migrate('--rollback');

    expect(code).toBe(0);
    expect(output).toContain('Everything written since the migration is lost.');

    const after = await names();
    expect(after.filter(name => name.startsWith('legacy_'))).toEqual([]);
    expect(after).not.toContain('spaces');
    expect(after).not.toContain('migrations');
    expect(await database.collection('devices').countDocuments()).toBe(fixture.counts.devices);
    expect(await database.collection('devicelogs').countDocuments()).toBe(fixture.counts.devicelogs);
  }, 120_000);

  it('refuses to roll back a database that was never migrated', async () => {
    const { code, output } = await migrate('--rollback');

    expect(code).toBe(1);
    expect(output).toContain('never run on it');
    expect(await database.collection('devices').countDocuments()).toBe(fixture.counts.devices);
  }, 60_000);
});
