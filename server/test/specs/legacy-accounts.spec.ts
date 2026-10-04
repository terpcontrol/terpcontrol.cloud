import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { hash } from 'bcrypt';
import { Db, MongoClient, ObjectId } from 'mongodb';
import supertest from 'supertest';
import { context } from '../support/api';
import { freePort } from '../support/infra/ports';

/**
 * Signing in afterwards, as the person whose account was migrated.
 *
 * The whole way round, because that is the only thing that answers the
 * question: a legacy-shaped database, the migration command an operator runs,
 * a real server started against what it produced, and `POST /v1/sessions` for
 * every account in it. What the transform makes of one row is the unit spec's
 * job; this is whether the person gets back in.
 *
 * The accounts are the spread a database that has been written to for years
 * holds. `is_admin` and `is_active` are declared `Boolean` and are not always
 * one: every release that read this collection read it through mongoose, which
 * casts rather than compares, so a row carrying `1` or `'true'` signed in for
 * as long as the old app ran and has to sign in here.
 */

const SERVER_ROOT = join(__dirname, '..', '..');
const DATABASE = 'legacy-account-spec';
const PASSWORD = 'correct horse battery';

const entryPoint = (built: string, source: string) =>
  process.env.HARNESS_BUILT === '1'
    ? { script: built, nodeArgs: [] as string[] }
    : { script: source, nodeArgs: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'] };

interface Account {
  /** What it is a case of, which is also what a failure is named by. */
  key: string;
  username: string;
  is_active?: unknown;
  is_admin?: unknown;
  /** What `POST /v1/sessions` answers, and what the account is once it is in. */
  expect: { status: number; code?: string; isAdmin?: boolean };
}

const ACCOUNTS: Account[] = [
  { key: 'active as a boolean', username: 'alice@example.test', is_active: true, expect: { status: 201, isAdmin: false } },
  { key: 'active as a number', username: 'bob@example.test', is_active: 1, expect: { status: 201, isAdmin: false } },
  { key: 'active as a string', username: 'carol@example.test', is_active: 'true', expect: { status: 201, isAdmin: false } },
  { key: 'active as yes', username: 'dave@example.test', is_active: 'yes', expect: { status: 201, isAdmin: false } },

  // Refused before the migration and refused after it, in words that say which
  // of the two it is - rather than signed in and then refused every request.
  { key: 'never activated', username: 'erin@example.test', is_active: false, expect: { status: 403, code: 'account_not_activated' } },
  { key: 'no flag at all', username: 'finn@example.test', expect: { status: 403, code: 'account_not_activated' } },
  { key: 'activated as no', username: 'gina@example.test', is_active: 'no', expect: { status: 403, code: 'account_not_activated' } },

  { key: 'an administrator', username: 'root-bool@example.test', is_active: true, is_admin: true, expect: { status: 201, isAdmin: true } },
  { key: 'an administrator by number', username: 'root-num@example.test', is_active: true, is_admin: 1, expect: { status: 201, isAdmin: true } },
  { key: 'an administrator by string', username: 'root-str@example.test', is_active: true, is_admin: 'true', expect: { status: 201, isAdmin: true } },
  { key: 'never an administrator', username: 'root-none@example.test', is_active: true, expect: { status: 201, isAdmin: false } },
];

const migrate = (...args: string[]): Promise<{ code: number | null; output: string }> => {
  const entry = entryPoint('dist/migrations/cli.js', 'src/migrations/cli.ts');
  const child = spawn('node', [...entry.nodeArgs, entry.script, ...args], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...context.appEnv, DB_DATABASE: DATABASE },
  });

  let output = '';
  child.stdout.on('data', chunk => (output += String(chunk)));
  child.stderr.on('data', chunk => (output += String(chunk)));

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
};

/** A server of its own, serving the migrated database. Its own log directory, so it stays out of the suite's. */
const start = async (): Promise<{ url: string; stop: () => Promise<void> }> => {
  const port = await freePort();
  const entry = entryPoint('dist/main.js', 'src/main.ts');
  const child = spawn('node', [...entry.nodeArgs, entry.script], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      ...context.appEnv,
      DB_DATABASE: DATABASE,
      PORT: String(port),
      LOG_DIR: join(SERVER_ROOT, 'test', '.tmp', 'logs-legacy-accounts'),
    },
  });

  let output = '';
  child.stdout.on('data', chunk => (output += String(chunk)));
  child.stderr.on('data', chunk => (output += String(chunk)));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${child.exitCode}:\n${output}`);
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) throw new Error(`the server never answered:\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return {
    url,
    stop: () =>
      new Promise<void>(resolve => {
        if (child.exitCode !== null) return resolve();
        const forced = setTimeout(() => child.kill('SIGKILL'), 5_000);
        child.once('exit', () => {
          clearTimeout(forced);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
};

/** The API rate-limits sign-ins per client address and trusts one proxy hop, so each attempt comes from its own. */
const signIn = (url: string, email: string) =>
  supertest(url)
    .post('/v1/sessions')
    .set('X-Forwarded-For', `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`)
    .send({ email, password: PASSWORD });

let client: MongoClient;
let database: Db;
let server: { url: string; stop: () => Promise<void> };

jest.setTimeout(300_000);

beforeAll(async () => {
  client = new MongoClient(context.mongoUri);
  await client.connect();
  database = client.db(DATABASE);
  await database.dropDatabase();

  // The old app hashed with bcrypt at cost 10, so the fixture's hashes are made
  // the same way: whether the stored hash still verifies is half the question.
  const passwordHash = await hash(PASSWORD, 10);
  await database.collection('users').insertMany(
    ACCOUNTS.map(account => ({
      _id: new ObjectId(),
      username: account.username,
      password: passwordHash,
      user_id: `user-${account.username.split('@')[0]}`,
      ...('is_active' in account ? { is_active: account.is_active } : {}),
      ...('is_admin' in account ? { is_admin: account.is_admin } : {}),
      __v: 0,
    })) as never[],
  );

  expect((await migrate()).code).toBe(0);
  server = await start();
});

afterAll(async () => {
  await server?.stop();
  await database?.dropDatabase();
  await client?.close();
});

describe('an account the old release could sign in', () => {
  it.each(ACCOUNTS)('$key', async account => {
    const response = await signIn(server.url, account.username);

    expect({ status: response.status, code: response.body?.code }).toEqual({
      status: account.expect.status,
      code: account.expect.code,
    });
    if (account.expect.status !== 201) return;

    expect(response.body.user.isAdmin).toBe(account.expect.isAdmin);

    // And it is signed in for more than the one request: an account that gets a
    // session and is then refused everything behind it is not signed in at all.
    const token = response.body.userToken.token;
    const me = await supertest(server.url).get('/v1/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);

    const listing = await supertest(server.url).get('/v1/admin/users').set('Authorization', `Bearer ${token}`);
    // An administrator stays one, and somebody who is not one is told no rather
    // than handed the answer a client reads as a dead session.
    expect(listing.status).toBe(account.expect.isAdmin ? 200 : 403);
  });

  it('signs in by the address it signed in by before', async () => {
    const rows = await database
      .collection<{ email: string; handle: string }>('users')
      .find({}, { projection: { _id: 0, email: 1 } })
      .toArray();

    // Plus the install's own administrator, which the server seeds for itself.
    expect(rows.map(row => row.email).sort()).toEqual(expect.arrayContaining(ACCOUNTS.map(account => account.username)));
  });
});
