import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Schema, mongo } from 'mongoose';
import { alarmRulesSchema } from '@database/schemas/v1/alarm-rules.schema';
import { alertsSchema } from '@database/schemas/v1/alerts.schema';
import { camerasSchema } from '@database/schemas/v1/cameras.schema';
import { claimCodesSchema } from '@database/schemas/v1/claim-codes.schema';
import { deviceClassesSchema } from '@database/schemas/v1/device-classes.schema';
import { devicesSchema } from '@database/schemas/v1/devices.schema';
import { entriesSchema } from '@database/schemas/v1/entries.schema';
import { firmwareBinariesSchema } from '@database/schemas/v1/firmware-binaries.schema';
import { firmwaresSchema } from '@database/schemas/v1/firmwares.schema';
import { growsSchema } from '@database/schemas/v1/grows.schema';
import { mediaSchema } from '@database/schemas/v1/media.schema';
import { migrationsSchema } from '@database/schemas/v1/migrations.schema';
import { planTemplatesSchema } from '@database/schemas/v1/plan-templates.schema';
import { plansSchema } from '@database/schemas/v1/plans.schema';
import { spacesSchema } from '@database/schemas/v1/spaces.schema';
import { usersSchema } from '@database/schemas/v1/users.schema';
import { cameraIdOf, planIdOf, spaceIdOf } from '@/migrations/ids';
import { MigrationContext } from '@/migrations/migration';
import { applyRollback, planRollback } from '@/migrations/migration-rollback';
import { MigrationRunner, RejectedRows, RunEvent, runProgress } from '@/migrations/migration-runner';
import { MIGRATION_STEPS } from '@/migrations/steps';
import { LEGACY_DEVICE_IDS, LEGACY_USER_IDS, LegacyDatabase, seedLegacyDatabase } from '../fixtures/legacy-database';

/**
 * The migrations, run over a database in today's shapes.
 *
 * The fixture beside this spec is the input and is never updated to follow the
 * new model; what is asserted here is the output, one claim per row of the
 * transform table. A real MongoDB rather than a stub: half of what a transform
 * does is an aggregate, a rename and an upsert, and none of those has behaviour
 * a stub could show.
 *
 * It is a unit spec rather than one of the integration suite because the
 * migrations have no HTTP surface at all - they run between the application
 * being built and the server listening - so the only way to drive them is to
 * call the runner.
 */

const AT = Date.UTC(2026, 8, 17);
const DAY = 24 * 60 * 60 * 1000;

/** Every collection the migration writes, with the schema that says what belongs in it. */
const V1_SCHEMAS: Record<string, Schema> = {
  alarmRules: alarmRulesSchema,
  alerts: alertsSchema,
  cameras: camerasSchema,
  claimCodes: claimCodesSchema,
  deviceClasses: deviceClassesSchema,
  devices: devicesSchema,
  entries: entriesSchema,
  firmwareBinaries: firmwareBinariesSchema,
  firmwares: firmwaresSchema,
  grows: growsSchema,
  media: mediaSchema,
  migrations: migrationsSchema,
  planTemplates: planTemplatesSchema,
  plans: plansSchema,
  spaces: spacesSchema,
  users: usersSchema,
};

/**
 * What a migration stamps from its own clock, which two runs of it cannot agree
 * on: the entitlement a camera is given twelve months of, the day a camera was
 * retired, the instant an alert record was made, the day a running grow was last
 * touched and the day a picture's bytes were moved into the bucket. Everything
 * else a migration writes is derived from the old document, so two runs over the
 * same data produce it byte for byte.
 */
const STAMPED_BY_THE_RUN: Record<string, string[]> = {
  alerts: ['createdAt'],
  cameras: ['entitlement.validUntil', 'removedAt'],
  grows: ['updatedAt'],
  'imagedata.files': ['uploadDate'],
};

type Document = Record<string, unknown>;
type Snapshot = Record<string, Document[]>;

let server: MongoMemoryServer;
let connection: Connection;
let fixture: LegacyDatabase;

const db = (): mongo.Db => connection.db!;
const collection = <T extends mongo.Document>(name: string) => db().collection<T>(name);
const one = <T extends mongo.Document>(name: string, filter: mongo.Filter<T>) => collection<T>(name).findOne(filter) as Promise<T | null>;
const names = async (database: mongo.Db = db()): Promise<string[]> =>
  (await database.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  connection = mongoose.createConnection(server.getUri('migration-spec'));
  await connection.asPromise();

  // Index building off: these models exist only to say what a stored document
  // has to look like, and building their unique indexes here would be the
  // server's job rather than this spec's.
  for (const [name, schema] of Object.entries(V1_SCHEMAS)) connection.model(name, schema.clone().set('autoIndex', false), name);
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

// The fixture holds rows on purpose that no transform can take, so a run of it
// stops on them unless it is told that leaving them behind is the intention.
// That refusal has a test of its own; everything else here is about what a
// complete run produces.
const migrate = () => new MigrationRunner(connection).run({ dryRun: false, allowRejects: true });

/**
 * Everything in a database, ordered so two of them can be compared.
 *
 * `_id` is dropped where mongoose invented one: an upsert draws a new ObjectId
 * every time, so two runs over the same data can never share one. What names a
 * document is its `id`, which every transform derives from the old document.
 */
const snapshotOf = async (database: mongo.Db, { acrossRuns = false }: { acrossRuns?: boolean } = {}): Promise<Snapshot> => {
  const snapshot: Snapshot = {};

  for (const name of (await names(database)).sort()) {
    // The record of the run itself: its durations and counts say how the
    // migration went, not what the database holds.
    if (acrossRuns && name === 'migrations') continue;

    const documents = (await database.collection(name).find({}).toArray()) as Document[];
    snapshot[name] = documents
      .map(document => ({ key: keyOf(document), document }))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(entry => comparable(name, entry.document, acrossRuns));
  }

  return snapshot;
};

/** What names a document within its collection: its `id`, a bucket file's name, or a chunk's file and number. */
const keyOf = (document: Document): string =>
  typeof document.id === 'string' ? document.id : `${String(document.files_id ?? document._id)}:${String(document.n ?? '')}`;

const comparable = (collectionName: string, document: Document, acrossRuns: boolean): Document => {
  const copy = { ...document };
  if (copy._id instanceof mongo.ObjectId) delete copy._id;
  if (acrossRuns) for (const path of STAMPED_BY_THE_RUN[collectionName] ?? []) drop(copy, path.split('.'));
  return copy;
};

const drop = (document: Document, path: string[]): void => {
  const [head, ...rest] = path;
  if (rest.length === 0) delete document[head];
  else if (document[head] !== null && typeof document[head] === 'object') drop(document[head] as Document, rest);
};

/**
 * A migration that dies in the middle of its work, which is the one thing a
 * resumable copy has to survive. The step keeps doing exactly what it does -
 * the rename, the reads, the transform - and stops after it has written a few
 * of its documents, with those documents already in the database and its own
 * record not yet written.
 */
const killPartWay = (name: string, afterWrites: number): (() => void) => {
  const index = MIGRATION_STEPS.findIndex(step => step.name === name);
  const original = MIGRATION_STEPS[index];

  MIGRATION_STEPS[index] = {
    name,
    async run(context: MigrationContext): Promise<void> {
      const write = context.write.bind(context);
      let left = afterWrites;

      (context as { write: MigrationContext['write'] }).write = async (target, document) => {
        await write(target, document);
        if (--left > 0) return;
        await context.flushAll();
        throw new Error('the process was killed part-way through');
      };

      await original.run(context);
    },
  };

  return () => {
    MIGRATION_STEPS[index] = original;
  };
};

/** A scratch database of its own, seeded and migrated, snapshotted and then dropped. */
const migratedScratchDatabase = async (name: string, killIn: string | null): Promise<Snapshot> => {
  const scratch = mongoose.createConnection(server.getUri(name));
  await scratch.asPromise();

  try {
    await seedLegacyDatabase(scratch, AT);

    if (killIn) {
      const restore = killPartWay(killIn, 5);
      try {
        await expect(new MigrationRunner(scratch).run({ dryRun: false, allowRejects: true })).rejects.toThrow(/killed part-way/u);
      } finally {
        restore();
      }
    }

    await new MigrationRunner(scratch).run({ dryRun: false, allowRejects: true });
    return await snapshotOf(scratch.db!, { acrossRuns: true });
  } finally {
    await scratch.dropDatabase();
    await scratch.close();
  }
};

describe('a dry run', () => {
  it('reports what it would do and writes nothing at all', async () => {
    const before = await names();
    const report = await new MigrationRunner(connection).run({ dryRun: true, allowRejects: true });

    expect(report.dryRun).toBe(true);
    expect(report.applied.map(outcome => outcome.name)).toHaveLength(MIGRATION_STEPS.length);
    expect(report.applied.find(outcome => outcome.name === '002-users')?.stats['users.written']).toBe(fixture.counts.users);

    expect((await names()).sort()).toEqual(before.sort());
    expect(await collection('spaces').countDocuments()).toBe(0);
    expect(await collection('migrations').countDocuments()).toBe(0);
  });

  it('reports the same rejects the real run reports, because that is what the rehearsal is read for', async () => {
    const described = (run: { applied: { name: string; rejects: { source: string; id: string; dropped: boolean }[] }[] }): string[] =>
      run.applied.flatMap(outcome => outcome.rejects.map(reject => `${outcome.name} ${reject.source}/${reject.id} ${reject.dropped}`));

    const rehearsed = await new MigrationRunner(connection).run({ dryRun: true, allowRejects: true });

    expect(described(await migrate())).toEqual(described(rehearsed));
  });
});

describe('the procedure', () => {
  it('moves every old collection aside and leaves it untouched', async () => {
    await migrate();

    for (const [name, count] of Object.entries(fixture.counts)) {
      if (name.startsWith('imagedata.')) continue;
      expect(await collection(`legacy_${name}`).countDocuments()).toBe(count);
    }
  });

  it('records each migration with its counts, and applies it once', async () => {
    await migrate();

    const record = await one<{ durationMs: number; stats: Record<string, number> }>('migrations', { name: '011-entries' });
    expect(record?.stats['entries.read']).toBe(fixture.counts.devicelogs);
    expect(typeof record?.durationMs).toBe('number');
    expect(await collection('migrations').countDocuments()).toBe(MIGRATION_STEPS.length);

    const second = await migrate();
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toHaveLength(MIGRATION_STEPS.length);
  });

  it('says what it is doing while it does it, and not only once it is over', async () => {
    const lines: string[] = [];
    const watch = (event: RunEvent) => lines.push(runProgress(event).line);

    await new MigrationRunner(connection).run({ dryRun: false, allowRejects: true, watch });

    // Before the first step rather than after the last: a step that names
    // itself as it starts is what a run of four minutes has instead of silence.
    expect(lines[0]).toBe(`Migrations: ${MIGRATION_STEPS.length} of ${MIGRATION_STEPS.length} to apply; checking the database first`);
    const started = lines.indexOf(`Migration ${MIGRATION_STEPS[0].name} starting (1 of ${MIGRATION_STEPS.length})`);
    const applied = lines.findIndex(line => line.startsWith(`Migration ${MIGRATION_STEPS[0].name} applied in `));
    expect(started).toBeGreaterThan(0);
    expect(applied).toBe(started + 1);
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^Migrations: finished; ${MIGRATION_STEPS.length} migrations applied in \\d+ ms`, 'u'));

    // The line that tells an already-migrated database from one the server
    // never looked at. Before it there was nothing to tell them apart by.
    const second: string[] = [];
    await new MigrationRunner(connection).run({ dryRun: false, allowRejects: true, watch: event => second.push(runProgress(event).line) });
    expect(second).toEqual([`Migrations: nothing to do; all ${MIGRATION_STEPS.length} of them have already been applied`]);
  });

  it('names the step it stopped at, so a log that ends in a failure says how far it got', async () => {
    const lines: string[] = [];
    const restore = killPartWay('004-spaces', 2);

    try {
      await expect(
        new MigrationRunner(connection).run({ dryRun: false, allowRejects: true, watch: event => lines.push(runProgress(event).line) }),
      ).rejects.toThrow(/killed part-way/u);
    } finally {
      restore();
    }

    expect(lines).toContain('Migrations: stopped at 004-spaces; nothing after that was written');
    expect(lines.filter(line => /^Migration 00[123].* applied in /u.test(line))).toHaveLength(3);
  });

  it('refuses a record that says everything has run over a database still in the old shapes', async () => {
    // What a restore leaves behind: `mongorestore --drop` drops only the
    // collections the archive carries, so the record of this release survives a
    // dump taken before it and claims a migration that never touched this data.
    await collection('migrations').insertMany(MIGRATION_STEPS.map(step => ({ id: `migration-${step.name}`, name: step.name, rejectCount: 0 })));

    await expect(migrate()).rejects.toThrow(/still hold what the previous release wrote: users, devices/u);
    expect((await names()).filter(name => name.startsWith('legacy_'))).toEqual([]);
  });

  it('has nothing to say against a record that matches the database it was written for', async () => {
    await migrate();

    // The same complete record, and this time the collections behind it really
    // are the new ones, so the second boot goes through in silence.
    await expect(migrate()).resolves.toMatchObject({ applied: [] });
  });

  it('leaves an empty collection where it is, because there is nothing there to migrate', async () => {
    // A fresh install, where mongoose has created the collections its models
    // declare an index on and nothing has ever been written into them.
    for (const existing of await db().collections()) await existing.drop();
    for (const name of ['users', 'devices', 'devicelogs', 'images']) await db().createCollection(name);

    await migrate();

    expect((await names()).filter(name => name.startsWith('legacy_'))).toEqual([]);
    expect(await names()).toEqual(expect.arrayContaining(['users', 'devices']));
  });
});

describe('what the migration wrote', () => {
  it('counts out against what the fixture put in', async () => {
    await migrate();

    const counted = async (name: string): Promise<number> => collection(name).countDocuments();

    expect({
      users: await counted('users'),
      devices: await counted('devices'),
      deviceClasses: await counted('deviceClasses'),
      firmwares: await counted('firmwares'),
      firmwareBinaries: await counted('firmwareBinaries'),
      claimCodes: await counted('claimCodes'),
      spaces: await counted('spaces'),
      plans: await counted('plans'),
      alarmRules: await counted('alarmRules'),
      alerts: await counted('alerts'),
      cameras: await counted('cameras'),
      planTemplates: await counted('planTemplates'),
      grows: await counted('grows'),
      entries: await counted('entries'),
      media: await counted('media'),
    }).toEqual({
      users: fixture.counts.users,
      devices: fixture.counts.devices,
      deviceClasses: fixture.counts.deviceclasses,
      firmwares: fixture.counts.devicefirmwares,
      // The row from before the file name was stored is not reachable over OTA.
      firmwareBinaries: fixture.counts.devicefirmwarebinaries - 1,
      // The code that names no device claims nothing.
      claimCodes: fixture.counts.claimcodes - 1,
      // One per claimed device; the device nobody has ever seen gets none.
      spaces: 5,
      // The two devices whose plan has steps, running or not.
      plans: 2,
      // Three on the tent's readings and one per output an alarm can watch.
      alarmRules: 8,
      // One per alarm standing triggered: the warm tent, and the racing fan.
      alerts: 2,
      // A stream each for the tent, the fridge and the demo tent, and a retired
      // one for the fan, whose stills outlived the camera they came from.
      cameras: 4,
      planTemplates: fixture.counts.recipetemplates,
      grows: 3,
      // Every line that is still in the collection is one somebody kept.
      entries: fixture.counts.devicelogs,
      media: fixture.counts.images,
    });
  });

  it('starts the collections the model deliberately does not carry over empty', async () => {
    await migrate();

    for (const name of ['shareLinks', 'chartViews', 'passwordResets', 'plants', 'memberships', 'invites', 'follows', 'reminders', 'schemes']) {
      expect(await collection(name).countDocuments()).toBe(0);
    }
  });

  it('writes documents the schema of their own collection accepts', async () => {
    await migrate();

    for (const name of Object.keys(V1_SCHEMAS)) {
      for (const document of await collection(name).find({}).toArray()) {
        const invalid = connection.model(name).hydrate(document).validateSync();
        expect(invalid && `${name}/${String(document.id)}: ${invalid.message}`).toBeFalsy();
      }
    }
  });
});

describe('the pictures written before the image store', () => {
  it('moves the bytes into the bucket and takes them off the document', async () => {
    await migrate();

    expect(await one('legacy_images', { image_id: fixture.images.inline, data: { $exists: true } })).toBeNull();
    expect(await one('imagedata.files', { _id: fixture.images.inline as never })).not.toBeNull();
    expect((await one<{ bytes: number }>('media', { id: fixture.images.inline }))?.bytes).toBeGreaterThan(0);
  });
});

describe('users', () => {
  it('renames the fields and gives every account a handle of its own', async () => {
    await migrate();

    const ada = await one<{ email: string; passwordHash: string; handle: string; isAdmin: boolean }>('users', { id: LEGACY_USER_IDS.ada });
    expect(ada?.email).toBe('ada@example.test');
    expect(ada?.handle).toBe('ada');
    expect(ada?.isAdmin).toBe(false);
    expect(ada?.passwordHash).toMatch(/^\$2b\$/u);

    // Off until configured, rather than filled in with the sign-in address.
    expect(await one<{ notifications: { channels: { email: string | null } } }>('users', { id: LEGACY_USER_IDS.ada })).toMatchObject({
      notifications: { channels: { email: null } },
    });
  });

  it('reads a flag the way the release that wrote it read it', async () => {
    await migrate();

    const flags = async (id: string) => one<{ isActive: boolean; isAdmin: boolean }>('users', { id });

    // Everything that ever read these rows read them through mongoose, which
    // casts to a boolean rather than comparing: an account stored with `1` or
    // `'true'` signed in for as long as the old app ran, so it signs in here.
    expect(await flags(LEGACY_USER_IDS.activeAsNumber)).toMatchObject({ isActive: true, isAdmin: false });
    expect(await flags(LEGACY_USER_IDS.activeAsString)).toMatchObject({ isActive: true, isAdmin: false });
    expect(await flags(LEGACY_USER_IDS.adminAsNumber)).toMatchObject({ isActive: true, isAdmin: true });

    // And an account the old app refused is still refused: the flag defaulted
    // to false where it was declared, and no flag at all is that default.
    expect(await flags(LEGACY_USER_IDS.withoutFlags)).toMatchObject({ isActive: false, isAdmin: false });
    expect(await flags(LEGACY_USER_IDS.inactive)).toMatchObject({ isActive: false, isAdmin: false });
    expect(await flags(LEGACY_USER_IDS.admin)).toMatchObject({ isActive: true, isAdmin: true });
  });

  it('refuses to run at all when two accounts share one user_id', async () => {
    await collection('users').insertOne({ username: 'clone@example.test', password: 'x', user_id: LEGACY_USER_IDS.ada });

    await expect(migrate()).rejects.toThrow(/share one user_id/u);
    expect(await names()).not.toContain('legacy_users');
  });
});

describe('devices', () => {
  it('parses the configuration and folds the update settings into one channel', async () => {
    await migrate();

    const tent = await one<Record<string, any>>('devices', { id: LEGACY_DEVICE_IDS.controller });
    expect(tent?.configuration.day.temperature).toBe(27);
    expect(tent?.firmware).toEqual({ channel: 'beta', targetId: null });
    expect(tent?.spaceId).toBe(spaceIdOf(LEGACY_DEVICE_IDS.controller));
    expect(tent?.settings.ppfdLuxFactor).toBe(0.0185);
    expect(tent?.state.maintenanceUntil).toBeInstanceOf(Date);
    // The camera's credentials left the report that is served; the rest of what
    // the device said about itself is kept exactly as it said it.
    expect(tent?.state.hardware.webcam_pwd).toBeUndefined();
    expect(tent?.state.hardware.webcam_url).toBeUndefined();
    expect(tent?.state.hardware.webcam_did).toBe('TCAM0001');
    expect(tent?.state.hardware.socket_list0).toContain('light|A4CF12000011');

    const plug = await one<Record<string, any>>('devices', { id: LEGACY_DEVICE_IDS.plug });
    expect(plug?.configuration).toBeNull();
    expect(plug?.firmware).toEqual({ channel: 'manual', targetId: 'fw-plug-1.2.0' });

    const light = await one<Record<string, any>>('devices', { id: LEGACY_DEVICE_IDS.light });
    expect(light?.ownerId).toBeNull();
    expect(light?.spaceId).toBeNull();
  });
});

describe('spaces', () => {
  it('makes one per claimed device, named and kinded after it', async () => {
    await migrate();

    expect(await one('spaces', { id: spaceIdOf(LEGACY_DEVICE_IDS.light) })).toBeNull();
    expect(await one<Record<string, any>>('spaces', { id: spaceIdOf(LEGACY_DEVICE_IDS.controller) })).toMatchObject({
      kind: 'tent',
      name: 'Tent',
      ownerId: LEGACY_USER_IDS.ada,
    });
    expect(await one<Record<string, any>>('spaces', { id: spaceIdOf(LEGACY_DEVICE_IDS.fridge) })).toMatchObject({ kind: 'fridge' });
    expect(await one<Record<string, any>>('spaces', { id: spaceIdOf(LEGACY_DEVICE_IDS.demo) })).toMatchObject({ isDemo: true });
  });
});

describe('plans', () => {
  it('takes the running plan off the device, with where it stands', async () => {
    await migrate();

    const plan = await one<Record<string, any>>('plans', { deviceId: LEGACY_DEVICE_IDS.controller });
    expect(plan?.id).toBe(planIdOf(LEGACY_DEVICE_IDS.controller));
    expect(plan?.steps).toHaveLength(4);
    expect(plan?.steps[2]).toMatchObject({ name: 'Vegetative', stage: 'vegetative', duration: { value: 4, unit: 'weeks' } });
    expect(plan?.steps[2].settings.day.temperature).toBe(27);
    expect(plan?.notify).toEqual({ mode: 'on_step', email: 'ada@example.test', writeEntries: true });
    expect(plan?.state).toMatchObject({ status: 'running', activeStepIndex: 2 });
    expect(plan?.state.stepStartedAt.getTime()).toBe(AT - 25 * DAY);
    expect(plan?.state.confirmationNotifiedAt).toBeInstanceOf(Date);
  });

  it('reads a plan that kept its steps and zeroed its clock as one that is not running', async () => {
    await migrate();

    const stopped = await one<Record<string, any>>('plans', { deviceId: LEGACY_DEVICE_IDS.fridge });
    expect(stopped?.steps).toHaveLength(2);
    expect(stopped?.state).toMatchObject({
      status: 'stopped',
      activeStepIndex: 0,
      stepStartedAt: null,
      lastAppliedAt: null,
      confirmationNotifiedAt: null,
    });
  });
});

describe('alarms', () => {
  it('becomes a rule each, and an open alert for the one that is standing triggered', async () => {
    await migrate();

    const warm = await one<Record<string, any>>('alarmRules', { id: fixture.alarms.triggered });
    expect(warm).toMatchObject({
      watch: { kind: 'reading', metric: 'temperature', upper: 31, lower: null },
      forSeconds: 300,
      severity: 'warning',
      enabled: true,
    });
    expect(warm?.delivery).toMatchObject({ mode: 'custom', custom: { channel: 'email', target: 'ada@example.test' } });
    expect(warm?.state).toMatchObject({ triggered: true, extremeValue: 33.4 });

    const webhook = await one<Record<string, any>>('alarmRules', { id: fixture.alarms.webhook });
    expect(webhook?.delivery.custom.webhook).toMatchObject({ method: 'POST', tunnel: true, reportErrors: true });
    expect(webhook?.delivery.custom.webhook.headers['X-Api-Key']).toBe('fixture-key');

    expect(await one<Record<string, any>>('alarmRules', { id: fixture.alarms.disabled })).toMatchObject({ enabled: false, severity: 'info' });

    const alerts = await collection<Record<string, any>>('alerts').find({ ruleId: fixture.alarms.triggered }).toArray();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      ruleId: fixture.alarms.triggered,
      deviceId: LEGACY_DEVICE_IDS.controller,
      spaceId: spaceIdOf(LEGACY_DEVICE_IDS.controller),
      resolvedAt: null,
      kind: 'threshold',
      severity: 'warning',
      value: null,
      extremeValue: 33.4,
    });
    // The episode began when the alarm last tripped, not when the migration ran.
    expect(alerts[0].startedAt.getTime()).toBe(AT - 2 * 60 * 60 * 1000);
  });

  it('leaves an alarm switched off whose flag is not a boolean', async () => {
    // The same cast the accounts turn on, and the one with the loudest
    // consequence: a rule that comes back enabled starts mailing whoever it
    // names the moment the server is up.
    await collection('devices').updateOne(
      { device_id: LEGACY_DEVICE_IDS.controller, 'alarms.alarmId': fixture.alarms.disabled },
      { $set: { 'alarms.$.disabled': 1 } },
    );

    await migrate();

    expect(await one<{ enabled: boolean }>('alarmRules', { id: fixture.alarms.disabled })).toMatchObject({ enabled: false });
  });

  it('carries an alarm on an output across as a rule on that output', async () => {
    await migrate();

    const outputs = fixture.alarms.outputs;
    const rule = (id: string) => one<Record<string, any>>('alarmRules', { id });

    // The fridge that has not stopped and the valve that is still open: on at
    // all is what trips them, so neither carries a band - and the threshold
    // left beside the valve, which nothing has ever read, is left behind.
    expect(await rule(outputs.running)).toMatchObject({
      watch: { kind: 'output_running', output: 'dehumidifier' },
      forSeconds: 3600,
      severity: 'warning',
    });
    expect(await rule(outputs.valve)).toMatchObject({ watch: { kind: 'output_running', output: 'co2', upper: null }, severity: 'info' });

    // The heater's thresholds were percentages of the fraction the device
    // reports, so they come back in the units the series is in.
    expect(await rule(outputs.heater)).toMatchObject({ watch: { kind: 'output_level', output: 'heater', upper: 0.8, lower: null } });

    // Every other output is compared against what it reports, unscaled.
    expect(await rule(outputs.fan)).toMatchObject({ watch: { kind: 'output_level', output: 'fan', upper: 11, lower: null }, forSeconds: 30 });
    expect(await rule(outputs.light)).toMatchObject({ watch: { kind: 'output_level', output: 'light', upper: 60, lower: 40 } });
  });

  it('opens an alert for an output alarm standing triggered, as for any other', async () => {
    await migrate();

    const alert = await one<Record<string, any>>('alerts', { ruleId: fixture.alarms.outputs.fan });
    expect(alert).toMatchObject({ deviceId: LEGACY_DEVICE_IDS.controller, resolvedAt: null, kind: 'threshold', extremeValue: 14 });
    expect(alert?.startedAt.getTime()).toBe(AT - 3 * 60 * 60 * 1000);
  });

  it('rejects an alarm on something that is neither a reading nor an output', async () => {
    await collection('devices').updateOne(
      { device_id: LEGACY_DEVICE_IDS.fridge },
      { $set: { alarms: [{ alarmId: 'alarm-fridge-nonsense', sensorType: 'pressure', actionType: 'info', actionTarget: '' }] } },
    );

    const report = await migrate();
    const reject = report.applied.find(outcome => outcome.name === '007-alarm-rules')?.rejects[0];

    expect(reject?.id).toBe('alarm-fridge-nonsense');
    expect(reject?.reason).toContain('neither a reading nor an output');
    expect(await one('alarmRules', { id: 'alarm-fridge-nonsense' })).toBeNull();
  });
});

describe('cameras', () => {
  it('makes the Terp Cam a camera of its own and keeps its secret out of the device', async () => {
    await migrate();

    const camera = await one<Record<string, any>>('cameras', { id: cameraIdOf(LEGACY_DEVICE_IDS.controller) });
    expect(camera).toMatchObject({ kind: 'terpcam_controller', did: 'TCAM0001', uid: 'UID0001TCAM', url: null, removedAt: null });
    expect(camera?.secret).toBe('fixture-cam-password');
    expect(camera?.entitlement.grant).toBe('migration');
    expect(camera?.entitlement.validUntil.getTime()).toBeGreaterThan(AT);
  });

  it('makes a camera of a device’s stream, and gives it the stills that came from it', async () => {
    await migrate();

    const fridge = await one<Record<string, any>>('cameras', { id: cameraIdOf(LEGACY_DEVICE_IDS.fridge) });
    expect(fridge).toMatchObject({
      kind: 'rtsp',
      deviceId: LEGACY_DEVICE_IDS.fridge,
      spaceId: spaceIdOf(LEGACY_DEVICE_IDS.fridge),
      url: 'rtsp://cam:secret@10.0.0.60:554/stream1',
      transport: 'tcp',
      tunnel: true,
      model: 'tapo_c200',
      maintenanceOff: true,
    });

    // The tent's own stream, and every picture its pipeline delivered.
    const tent = cameraIdOf(LEGACY_DEVICE_IDS.controller);
    const delivered = await collection<Record<string, any>>('media').find({ cameraId: tent }).toArray();
    expect(delivered.map(picture => picture.id).sort()).toEqual(
      [...fixture.images.stills, ...Object.values(fixture.images.timelapses), fixture.images.inline].sort(),
    );
  });

  it('gives a device that has stills but no stream a retired camera, so no picture loses its link', async () => {
    await migrate();

    const retired = await one<Record<string, any>>('cameras', { id: cameraIdOf(LEGACY_DEVICE_IDS.fan) });
    expect(retired?.removedAt).toBeInstanceOf(Date);

    for (const imageId of fixture.images.withoutCamera) {
      expect((await one<Record<string, any>>('media', { id: imageId }))?.cameraId).toBe(retired?.id);
    }
  });
});

describe('plan templates', () => {
  it('keeps two owners’ templates of one name, and hands the install’s own to an administrator', async () => {
    await migrate();

    const shared = await collection<Record<string, any>>('planTemplates').find({ name: fixture.templates.duplicateName }).toArray();
    expect(shared.map(template => template.ownerId).sort()).toEqual([LEGACY_USER_IDS.ada, LEGACY_USER_IDS.ben].sort());

    expect(await one<Record<string, any>>('planTemplates', { name: 'Photoperiod starter' })).toMatchObject({
      ownerId: LEGACY_USER_IDS.admin,
      isPublic: true,
    });
  });
});

describe('grows', () => {
  it('reconstructs a cycle per rollback or rename, with its phases in order and one placement', async () => {
    await migrate();

    const grows = await collection<Record<string, any>>('grows').find({}).sort({ startedAt: 1 }).toArray();
    expect(grows.map(grow => grow.name)).toEqual([fixture.grows.finished.name, fixture.grows.merged.name, fixture.grows.running.name]);

    const finished = grows.find(grow => grow.name === fixture.grows.finished.name)!;
    const startedAt = finished.phases.map((phase: any) => phase.startedAt.getTime());

    expect(finished.phases.map((phase: any) => phase.stage)).toEqual(['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing']);
    expect(startedAt).toEqual([...startedAt].sort((left: number, right: number) => left - right));
    expect(finished.endedAt.getTime()).toBe(fixture.grows.finished.endedAt);
    expect(finished.placements).toHaveLength(1);
    expect(finished.placements[0]).toMatchObject({ spaceId: spaceIdOf(LEGACY_DEVICE_IDS.controller), plantIds: null });
    expect(finished.measurements).toHaveLength(8);
    expect(finished.slug).toMatch(/^blue-dream-/u);

    // Two plantings of one strain with no rollback between them are one grow.
    expect(grows.find(grow => grow.name === fixture.grows.merged.name)?.phases).toHaveLength(fixture.grows.merged.stages);
  });

  it('starts the day counter where the first lifecycle entry is', async () => {
    await migrate();

    const running = await one<Record<string, any>>('grows', { name: fixture.grows.running.name });
    // `day = floor((now - phases[0].startedAt) / 1 d) + 1`, from the ADR.
    const day = Math.floor((AT - running!.phases[0].startedAt.getTime()) / DAY) + 1;

    expect(running?.startedAt.getTime()).toBe(fixture.grows.running.startedAt);
    expect(running?.phases[0].startedAt.getTime()).toBe(fixture.grows.running.startedAt);
    expect(running?.endedAt).toBeNull();
    expect(day).toBe(41);
  });
});

describe('entries', () => {
  it('writes one of every kind the transform produces', async () => {
    await migrate();

    const kinds = await collection('entries').distinct('kind');
    expect(kinds.sort()).toEqual(['alarm', 'measurement', 'note', 'phase', 'plan', 'system']);
  });

  it('reads the kind and the source off the categories', async () => {
    await migrate();

    const kinds = await collection<Record<string, any>>('entries').find({}).toArray();
    const byMessage = (key: string) => kinds.find(entry => entry.message?.key === key);

    expect(byMessage('message-alarm-triggered')).toMatchObject({ kind: 'alarm', source: 'alarm', severity: 'warning' });
    expect(byMessage('message-recipe-advanced')).toMatchObject({ kind: 'plan', source: 'plan' });
    expect(byMessage('message-recipe-advanced')?.values).toMatchObject({ planId: planIdOf(LEGACY_DEVICE_IDS.controller), stepIndex: 2 });
    expect(byMessage('message-co2-low')).toMatchObject({ kind: 'system', source: 'device', severity: 'warning' });
    expect(byMessage('message-co2-low')?.message.params).toEqual(['380']);
    expect(byMessage('message-rtsp-stream-error')).toMatchObject({ cameraId: cameraIdOf(LEGACY_DEVICE_IDS.fridge) });
  });

  it('keeps what a person wrote as text and points a photo entry at its pictures', async () => {
    await migrate();

    const note = await one<Record<string, any>>('entries', { text: 'Topped both plants and tied them down.' });
    expect(note).toMatchObject({ kind: 'note', source: 'human', authorId: LEGACY_USER_IDS.ada, mediaIds: fixture.images.photos });
    expect(note?.growId).not.toBeNull();
    expect(note?.spaceId).toBe(spaceIdOf(LEGACY_DEVICE_IDS.controller));
  });

  it('turns the fixed measurement fields into readings', async () => {
    await migrate();

    const measurement = await one<Record<string, any>>('entries', { kind: 'measurement', text: 'Weekly readings.' });
    const readings = Object.fromEntries(measurement!.values.readings.map((reading: any) => [reading.key, reading.value]));
    expect(readings).toMatchObject({ phMeasurement: 6.2, ecMeasurement: 1.6, co2FillingInitial: 425 });
  });

  it('writes a lifecycle entry as a phase entry naming the phase of its grow', async () => {
    await migrate();

    const phases = await collection<Record<string, any>>('entries').find({ kind: 'phase' }).toArray();
    const grow = await one<Record<string, any>>('grows', { name: fixture.grows.running.name });
    const phaseIds = new Set(grow?.phases.map((phase: any) => phase.id));

    // The app writes `['diary', <slug>]`, the plan engine the slug alone.
    expect(phases.filter(entry => entry.source === 'human').length).toBeGreaterThan(0);
    expect(phases.filter(entry => entry.source === 'plan').length).toBeGreaterThan(0);
    expect(phases.filter(entry => phaseIds.has(entry.values.phaseId))).toHaveLength(fixture.grows.running.stages);
  });

  it('carries every line that is still there, whatever the deleted flag says', async () => {
    // The app sets the flag on every diary entry it writes and deleting one
    // really removed the row, so a line carrying it is a line somebody kept -
    // and reading the flag as a deletion would empty a grower's whole diary.
    const report = await migrate();

    expect(await one<Record<string, any>>('entries', { text: 'Wrong device.' })).toMatchObject({ kind: 'note', source: 'human' });
    expect(await one<Record<string, any>>('entries', { 'message.key': 'message-device-configuration-updated' })).toMatchObject({ kind: 'system' });
    expect(await one<Record<string, any>>('entries', { 'message.key': 'message-recipe-step-manually-activated' })).toMatchObject({ kind: 'plan' });

    const rejects = report.applied.find(outcome => outcome.name === '011-entries')?.rejects ?? [];
    expect(rejects.some(reject => reject.reason.includes('author deleted'))).toBe(false);
  });
});

describe('media', () => {
  it('keeps the picture id, so the bytes stay where they are', async () => {
    await migrate();

    for (const imageId of fixture.images.stills) {
      expect(await one<Record<string, any>>('media', { id: imageId })).toMatchObject({
        kind: 'still',
        mime: 'image/jpeg',
        cameraId: cameraIdOf(LEGACY_DEVICE_IDS.controller),
      });
    }

    expect(await one<Record<string, any>>('media', { id: fixture.images.timelapses['1w'] })).toMatchObject({ kind: 'timelapse', window: 'week' });

    const photo = await one<Record<string, any>>('media', { id: fixture.images.photos[0] });
    expect(photo).toMatchObject({ kind: 'photo', cameraId: null, uploadedBy: LEGACY_USER_IDS.ada, spaceId: spaceIdOf(LEGACY_DEVICE_IDS.controller) });
    expect(photo?.growId).not.toBeNull();
  });
});

describe('the documents no transform can take', () => {
  it('stops the run at the step that could not take them, and says which rows they were', async () => {
    // A report nobody has to read is not a safeguard: a rule that dropped every
    // diary line anybody had written reported each one and finished green.
    const run = new MigrationRunner(connection).run({ dryRun: false });

    await expect(run).rejects.toThrow(RejectedRows);
    await expect(run).rejects.toThrow(/devicefirmwarebinaries/u);

    // It stopped where it stopped: the steps before it are applied, the ones
    // after it have not run, and the collections they read are untouched.
    expect(await collection('migrations').countDocuments()).toBeGreaterThan(0);
    expect(await collection('migrations').countDocuments()).toBeLessThan(MIGRATION_STEPS.length);
    expect(await collection('entries').countDocuments()).toBe(0);
    expect(await collection('devicelogs').countDocuments()).toBe(fixture.counts.devicelogs);
  });

  it('stops again on the next run, rather than skipping the step it could not finish', async () => {
    await expect(new MigrationRunner(connection).run({ dryRun: false })).rejects.toThrow(RejectedRows);
    await expect(new MigrationRunner(connection).run({ dryRun: false })).rejects.toThrow(/devicefirmwarebinaries/u);
  });

  it('carries on from where it stopped once it is told the rows may be left behind', async () => {
    await expect(new MigrationRunner(connection).run({ dryRun: false })).rejects.toThrow(RejectedRows);

    const report = await migrate();

    expect(report.applied.length + report.alreadyApplied.length).toBe(MIGRATION_STEPS.length);
    expect(await collection('entries').countDocuments()).toBe(fixture.counts.devicelogs);
  });

  it('reports every one of them and runs to the end anyway', async () => {
    const report = await migrate();
    const rejects = report.applied.flatMap(outcome => outcome.rejects.map(reject => ({ step: outcome.name, ...reject })));

    expect(rejects.map(reject => `${reject.step} ${reject.source} ${reject.dropped ? 'dropped' : 'kept'}`)).toEqual([
      // A build's file from before the name was stored: OTA asks for a file by
      // name, so a row without one has never answered a request.
      '003-fleet devicefirmwarebinaries dropped',
      '003-fleet claimcodes dropped',
      // The configuration that is not JSON: the device is migrated without one.
      '005-devices devices kept',
    ]);

    const configuration = rejects.find(reject => reject.source === 'devices');
    expect(configuration?.id).toBe(LEGACY_DEVICE_IDS.fan);
    expect(configuration?.detail).toContain('"workmode":"small"');
    expect((await one<Record<string, any>>('devices', { id: LEGACY_DEVICE_IDS.fan }))?.configuration).toBeNull();

    expect(rejects.find(reject => reject.source === 'claimcodes')?.id).toBe(fixture.claimCodes.orphan);
    expect(await one('claimCodes', { code: fixture.claimCodes.orphan })).toBeNull();
    expect(await one<Record<string, any>>('claimCodes', { code: fixture.claimCodes.forLightDevice })).toMatchObject({
      deviceId: LEGACY_DEVICE_IDS.light,
    });
  });

  it('keeps every one of them in the record it wrote, with its count', async () => {
    await migrate();

    const record = await one<Record<string, any>>('migrations', { name: '003-fleet' });
    expect(record?.rejectCount).toBe(2);
    expect(record?.rejects).toHaveLength(2);
  });
});

describe('the collections that are not migrated', () => {
  it('moves them aside and counts what was left behind', async () => {
    const report = await migrate();
    const stats = report.applied.find(outcome => outcome.name === '013-retired-collections')?.stats;

    expect(stats?.['shares.leftBehind']).toBe(fixture.counts.shares);
    expect(await collection('shareLinks').countDocuments()).toBe(0);
    expect(await collection('chartViews').countDocuments()).toBe(0);
    expect(await names()).toEqual(expect.arrayContaining(['legacy_shares', 'legacy_chartpresets', 'legacy_passwordtokens']));
  });
});

describe('running the migrations twice', () => {
  it('leaves exactly the database the first run left', async () => {
    await migrate();
    const migrated = await snapshotOf(db());

    const second = await migrate();

    expect(second.applied).toEqual([]);
    expect(await snapshotOf(db())).toEqual(migrated);
  });

  it('rewrites the same documents rather than second ones when every step is made to run again', async () => {
    await migrate();
    const migrated = await snapshotOf(db(), { acrossRuns: true });

    // What the record says has run is the only thing keeping a step from
    // running again, so forgetting it is how every transform is made to repeat.
    await collection('migrations').deleteMany({});
    await migrate();

    expect(await snapshotOf(db(), { acrossRuns: true })).toEqual(migrated);
  });
});

describe('a run that was killed part-way', () => {
  it('continues where it stopped and ends where an uninterrupted run ends', async () => {
    const [resumed, uninterrupted] = [await migratedScratchDatabase('killed-run', '011-entries'), await migratedScratchDatabase('clean-run', null)];

    expect(resumed).toEqual(uninterrupted);
  });

  it('never touches the old data again once it has been moved aside', async () => {
    const restore = killPartWay('011-entries', 5);
    try {
      await expect(migrate()).rejects.toThrow(/killed part-way/u);
    } finally {
      restore();
    }

    // The rename happened, a few entries were written and the record was not.
    expect(await names()).toContain('legacy_devicelogs');
    expect(await collection('entries').countDocuments()).toBe(5);
    expect(await one('migrations', { name: '011-entries' })).toBeNull();

    await migrate();

    expect(await collection('legacy_devicelogs').countDocuments()).toBe(fixture.counts.devicelogs);
    expect(await collection('entries').countDocuments()).toBe(fixture.counts.devicelogs);
    expect(await collection('migrations').countDocuments()).toBe(MIGRATION_STEPS.length);
  });
});

describe('going back', () => {
  it('drops what was built and puts the old collections back', async () => {
    await migrate();
    const migrated = await snapshotOf(db());

    await applyRollback(db(), await planRollback(db()));
    const restored = await snapshotOf(db());

    // Every collection that was moved aside stands under its own name again,
    // with exactly the documents it was moved aside with.
    for (const [name, documents] of Object.entries(migrated)) {
      if (name.startsWith('legacy_')) expect(restored[name.slice('legacy_'.length)]).toEqual(documents);
    }

    // And nothing of the new model is left for the previous release to trip over.
    expect(Object.keys(restored).sort()).toEqual(
      ['imagedata.chunks', 'imagedata.files', ...Object.keys(fixture.counts).filter(name => !name.startsWith('imagedata.'))].sort(),
    );

    expect(await collection('devices').countDocuments()).toBe(fixture.counts.devices);
    expect(await one<Record<string, any>>('devices', { device_id: LEGACY_DEVICE_IDS.controller })).toMatchObject({ owner_id: LEGACY_USER_IDS.ada });
  });

  it('refuses on a database that was never migrated', async () => {
    await expect(planRollback(db())).rejects.toThrow(/never run on it/u);
  });
});
