import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Db, MongoClient } from 'mongodb';
import { LegacyDatabase, seedLegacyDatabase } from '../fixtures/legacy-database';
import { context } from '../support/api';

/**
 * The migration as an operator runs it: `npm run migrate`, its dry run and its
 * check, against a database of its own on the MongoDB the suite already has.
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

const entryPoint = (built: string, source: string) =>
  process.env.HARNESS_BUILT === '1'
    ? { script: built, nodeArgs: [] as string[] }
    : { script: source, nodeArgs: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'] };

interface Outcome {
  code: number | null;
  output: string;
}

const migrate = (...args: string[]): Promise<Outcome> => {
  const entry = entryPoint('dist/migrations/cli.js', 'src/migrations/cli.ts');
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

/**
 * The server itself, booted against this spec's database and stopped again as
 * soon as it has said what it was going to say.
 *
 * What an operator watching `docker compose logs -f server` sees is the thing
 * report 1 was about, and only a real boot shows it: the command above never
 * runs `runAtBoot`. Its own log directory, so nothing it writes lands in the
 * one the rest of the suite reads.
 */
const boot = async ({ allowRejects = false }: { allowRejects?: boolean } = {}): Promise<string> => {
  const entry = entryPoint('dist/main.js', 'src/main.ts');
  const child = spawn('node', [...entry.nodeArgs, entry.script], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      ...context.appEnv,
      DB_DATABASE: DATABASE,
      PORT: '0',
      MIGRATION_ALLOW_REJECTS: String(allowRejects),
      LOG_DIR: join(SERVER_ROOT, 'test', '.tmp', 'logs-migration-boot'),
    },
  });

  let output = '';
  child.stdout.on('data', chunk => (output += String(chunk)));
  child.stderr.on('data', chunk => (output += String(chunk)));

  return new Promise<string>((resolve, reject) => {
    const give = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The server neither listened nor stopped within 120s. Output:\n${output}`));
    }, 120_000);

    const done = () => {
      clearTimeout(give);
      clearInterval(watching);
      resolve(output);
    };

    const watching = setInterval(() => {
      if (output.includes('API listening on port')) {
        child.once('exit', done);
        child.kill('SIGTERM');
      }
    }, 100);

    child.on('error', reject);
    child.on('exit', done);
  });
};

let client: MongoClient;
let database: Db;
let fixture: LegacyDatabase;

const names = async (): Promise<string[]> => (await database.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort();

/** The indexes a collection carries, named the way the schemas declare them. */
const indexesOf = async (name: string): Promise<string[]> =>
  (await database.collection(name).indexes()).map(index => `${JSON.stringify(index.key)}${index.unique ? ' unique' : ''}`);

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
    // Reported as each step finished it, in the words of a run that wrote none of it.
    expect(output).toContain(`Migration 002-users rehearsed in`);
    expect(output).toContain(`users.written=${fixture.counts.users}`);
    expect(output).toContain(`media.written=${fixture.counts.images}`);

    expect(await names()).toEqual(before);
    expect(await database.collection('migrations').countDocuments()).toBe(0);
  }, 60_000);

  it('rehearses every transform on a dry run, including the ones after a step that rejects', async () => {
    // A rehearsal is read to find out what the real run will refuse. Stopping
    // at the first step with a reject in it would report that step's rows and
    // stay silent about every transform after it - here, the pictures.
    const { code, output } = await migrate('--dry-run');

    expect(code).toBe(0);
    expect(output).toContain('Dry run: nothing was written.');
    expect(output).toContain('Migration 003-fleet rehearsed in');
    expect(output).toContain(`media.written=${fixture.counts.images}`);
    expect(output).toMatch(/Migrations: finished; 14 migrations rehearsed in/u);
    expect(await names()).not.toContain('spaces');
  }, 120_000);

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

  it('reports as it goes, so a run over a big database is not silence until it ends', async () => {
    const { output } = await migrate('--allow-rejects');
    const lines = output.split('\n');

    const starting = lines.findIndex(line => line === 'Migration 002-users starting (2 of 14)');
    const applied = lines.findIndex(line => line.startsWith('Migration 002-users applied in '));
    const later = lines.findIndex(line => line === 'Migration 003-fleet starting (3 of 14)');

    expect(lines[0]).toContain('14 of 14 to apply; checking the database first');
    expect(starting).toBeGreaterThan(0);
    // Each step is reported where it happens, rather than every step at the end.
    expect(applied).toBe(starting + 1);
    expect(later).toBe(applied + 1);
    expect(output).toMatch(/Migrations: finished; 14 migrations applied in \d+ ms, \d+ rows refused/u);
  }, 120_000);

  it('starts from the index state a boot starts from, so a copy is not a collection scan', async () => {
    // Every copy the migration makes is an upsert by `id`. A boot has the
    // models compiled and their unique `id` index built before the first of
    // them; under a bare connection the collection is created by the first
    // write and carries `_id` and nothing else, so each upsert after it reads
    // everything the step has written so far - which on 7.7 million entries is
    // the difference between minutes and a day.
    //
    // This run stops at 003-fleet, long before an entry or a picture is
    // written, so an index on those collections here is one that was built
    // before a single step ran rather than by the writes themselves.
    expect((await migrate()).code).toBe(1);

    expect(await indexesOf('entries')).toContain('{"id":1} unique');
    expect(await indexesOf('media')).toContain('{"id":1} unique');

    // The two collections that keep the name of the shapes they are replacing
    // are the exception a boot makes as well: an unmigrated document carries
    // none of the fields their unique indexes are on, so nothing is built on
    // them until the rename has separated the two.
    expect(await indexesOf('users')).toEqual(['{"_id":1}']);
    expect(await indexesOf('devices')).toEqual(['{"_id":1}']);

    expect((await migrate('--allow-rejects')).code).toBe(0);

    // And once a run has finished, where a boot builds them.
    expect(await indexesOf('users')).toEqual(expect.arrayContaining(['{"id":1} unique', '{"email":1} unique', '{"handle":1} unique']));
    expect(await indexesOf('devices')).toContain('{"id":1} unique');
  }, 120_000);

  it('refuses a record that says everything has run over a database still in the old shapes', async () => {
    // What a restore of a dump from before the upgrade leaves behind:
    // `mongorestore --drop` drops only the collections the archive carries, so
    // a record written when this database was empty survives it.
    await database.dropDatabase();
    expect((await migrate()).code).toBe(0);
    // `--drop` drops each collection the archive carries before restoring it,
    // indexes and all - which is why an account of the old shape lands in a
    // `users` the run had built the new model's unique indexes on.
    for (const name of ['users', 'devices']) await database.dropCollection(name).catch(() => undefined);
    await seedLegacyDatabase(database, AT);

    const { code, output } = await migrate('--allow-rejects');

    expect(code).toBe(1);
    expect(output).toContain('still hold what the previous release wrote: users, devices');
    expect(output).toContain('Drop `migrations` and `migrationLock`');
    // The reason is the whole answer: no stack, and nothing written. Counted
    // rather than looked for by name - the run before it built the indexes a
    // boot builds, and an index creates the empty collection it is on.
    expect(output).not.toContain('    at ');
    expect(await database.collection('spaces').countDocuments()).toBe(0);

    expect((await migrate('--check')).output).toContain('still hold what the previous release wrote');
  }, 120_000);

  it('says what a rehearsal does not measure, because its duration is the only number anybody has', async () => {
    const { code, output } = await migrate('--dry-run', '--allow-rejects');

    expect(code).toBe(0);
    // The clause on the run's own line, and the paragraph under the report.
    expect(output).toMatch(/Migrations: finished; 14 migrations rehearsed in \d+ ms.*, of which \d+ documents were transformed and none written/u);
    expect(output).toContain('How long that took is not how long the upgrade takes.');
    expect(output).toContain('a real run upserts every one of them by `id`,');
    // The real run says nothing of the sort, because its duration is the outage.
    expect((await migrate('--allow-rejects')).output).not.toContain('How long that took is not how long the upgrade takes.');
  }, 120_000);

  it('refuses a database holding two generations of the old data, and says what to do with it', async () => {
    await migrate('--allow-rejects');
    // A dump taken before the upgrade, restored over the migrated database:
    // what the migration moved aside on the day stands beside what was just
    // restored, and following "drop the record and start again" would migrate
    // the first and silently leave the second where it is.
    await database.collection('devicelogs').insertOne({ device_id: fixture.devices.controller, message: 'restored from a dump' });

    const run = await migrate('--allow-rejects');

    expect(run.code).toBe(1);
    expect(run.output).toContain('two generations of the old data at once');
    expect(run.output).toContain('on this database it is not the way out');
    expect(run.output).toContain('Decide which of the two copies is authoritative and drop the other');
    expect(run.output).not.toContain('    at ');

    const check = await migrate('--check');

    expect(check.code).toBe(1);
    expect(check.output).toContain('Decide which of the two copies is authoritative and drop the other');
    // Nothing of the restore was touched, and nothing of the migration either.
    expect(await database.collection('devicelogs').countDocuments()).toBe(1);
    expect(await database.collection('legacy_devicelogs').countDocuments()).toBe(fixture.counts.devicelogs);
  }, 120_000);
});

describe('what the server says at boot', () => {
  it('says the migration ran, step by step, and says so again when there is nothing to do', async () => {
    const first = await boot({ allowRejects: true });

    expect(first).toContain('Migrations: 14 of 14 to apply');
    expect(first).toContain('Migration 002-users starting (2 of 14)');
    expect(first).toMatch(/Migrations: finished; 14 migrations applied in \d+ ms/u);
    expect(first).toContain('API listening on port');

    // The line report 1 was about: before it, a boot with nothing to do said
    // nothing at all, and "already migrated" looked exactly like "never ran".
    const second = await boot({ allowRejects: true });

    expect(second).toContain('Migrations: nothing to do; all 14 of them have already been applied');
    expect(second).toContain('API listening on port');
  }, 300_000);

  it('stops on the rows it could not take, and says how far it had got', async () => {
    const output = await boot();

    expect(output).toContain('Migration 002-users applied in');
    expect(output).toContain('Migrations: stopped at 003-fleet; nothing after that was written');
    expect(output).toContain('could not take 2 rows, and the run stopped there');
    // The refusal is a report to read: written once, with no stack bolted onto
    // it, and what ends the boot is one line rather than the whole of it again.
    expect(output.split('could not take 2 rows')).toHaveLength(2);
    expect(output).toContain('Failed to start: Error: Migrations: the database was not migrated; the reason is above');
  }, 300_000);
});
