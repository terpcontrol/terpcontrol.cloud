import { mongo } from 'mongoose';
import { loadDeviceFacts } from './device-facts';
import { LEGACY, flagOf, fromTable, instantOf, numberOf, textOf } from './legacy';
import { LEGACY_PREFIX, MigrationContext } from './migration';

/**
 * What a migration refuses to start on, found before a single collection is
 * renamed aside.
 *
 * A transform can reject a document and carry on; what it cannot do is decide
 * between two rows that both claim to be the same thing. Two accounts under one
 * `user_id` own one set of devices, and nothing in the data says which of them
 * the devices are. That is not a reject, it is a question for the person who
 * knows the accounts - so the run stops, and it stops before it has written
 * anything, with every such question in one list rather than one question per
 * attempt.
 *
 * **Everything here counts what is in the collections.** An index is not asked
 * and not believed: mongoose builds a model's indexes in the background and
 * swallows a build that failed, so a unique index added to a collection that
 * already held duplicates never finished, never complained, and is still listed
 * as if it held.
 *
 * What is checked is what a transform cannot survive: every unique index the new
 * collections declare against the rows a transform would produce for it, every
 * id a transform derives from something that is not unique, and every reference
 * that would be copied pointing at a row that is not there. What is *not*
 * checked is everything a transform already answers for by itself - a duplicate
 * `class_id`, `firmware_id` or `alarmId` keeps the first row and rejects the
 * rest by decision, an unparseable configuration is migrated without one, a
 * claim code that names no device is dropped. Those are recorded as rejects on a
 * run that goes through.
 */

/** Groups listed per problem. A database with thousands of them is one to fix a few at a time, not one to print. */
const GROUP_LIMIT = 200;

/** Rows read for a problem that is not a group of duplicates, for the same reason. */
const ROW_LIMIT = 500;

/** One row that shares a value with another, and what tells it from the others. */
export interface PreflightRow {
  /** Its `_id`: what names it in the database somebody now has to open. */
  id: string;
  facts: string[];
}

export interface PreflightGroup {
  /** The value the rows share, as the report names it. */
  value: string;
  rows: PreflightRow[];
}

export interface PreflightProblem {
  /** What is wrong, in one line. */
  what: string;
  /** What it breaks if it is not fixed. */
  breaks: string;
  groups: PreflightGroup[];
  /** More groups were found than are listed. */
  capped: boolean;
}

export interface PreflightReport {
  problems: PreflightProblem[];
  /** Rows over every problem, which is how much there is to look at. */
  rows: number;
}

/** Thrown by the runner and by the CLI. Its message is the whole report, so whatever prints an error prints it. */
export class PreflightFailure extends Error {
  constructor(public readonly report: PreflightReport) {
    super(formatPreflight(report));
    this.name = 'PreflightFailure';
  }
}

/**
 * The record says every migration has already run, and the database says
 * otherwise. Its message is the whole reason, so whatever prints an error
 * prints it.
 */
export class StaleMigrationRecord extends Error {
  constructor(
    public readonly collections: string[],
    recorded: number,
    ofSteps: number,
  ) {
    const whole = recorded >= ofSteps;
    super(
      [
        `The record says ${whole ? 'every migration has already been applied' : `${recorded} of ${ofSteps} migrations have already been applied`}, ` +
          `but these collections still hold what the previous release wrote: ${collections.join(', ')}.`,
        '',
        whole
          ? 'Nothing has been written, and nothing would have been: with every step recorded there is nothing left to apply, so a boot would have\nmigrated none of this and served accounts in a shape nobody can sign in to.'
          : 'Nothing has been written. Each of these is a collection a recorded step reads and moves aside, so a step that says it ran has not run\nover this data - and the steps that are still pending would have transformed half of it and let the server start on the rest.',
        '',
        'A dump taken before the upgrade, restored into a database this release had already started against, is exactly this: a restore drops',
        'only the collections the archive carries, so the `migrations` record of the database it was restored into survives it.',
        '',
        'Drop `migrations` and `migrationLock`, then start again.',
      ].join('\n'),
    );
    this.name = 'StaleMigrationRecord';
  }
}

/**
 * What only the previous release ever wrote, still standing under its own name.
 *
 * `users` and `devices` are the two collections this release keeps the name of,
 * so those are asked for a field only the old shape carries. The other ten have
 * no reader in this release at all, so rows standing in them is the whole
 * answer - and an old collection that was empty is never renamed aside, so it
 * is counted rather than looked for.
 */
const OLD_SHAPE: Record<string, mongo.Filter<mongo.Document>> = {
  [LEGACY.users]: { user_id: { $exists: true } },
  [LEGACY.devices]: { device_id: { $exists: true } },
};

/** Whether a collection standing under its own name holds what only the previous release ever wrote. */
export const holdsWhatThePreviousReleaseWrote = async (db: mongo.Db, collection: string): Promise<boolean> =>
  (await db.collection(collection).countDocuments(fromTable(OLD_SHAPE, collection) ?? {}, { limit: 1 })) > 0;

/**
 * The old data in two generations at once, which no command can reason about.
 *
 * A dump taken before the upgrade and restored over a migrated database leaves
 * `devicelogs` standing beside the `legacy_devicelogs` the migration had moved
 * aside on the day, because `mongorestore --drop` drops only the collections its
 * own archive carries. Nothing in the data says which of the two is the one to
 * keep, and every command here would pick the wrong one silently: a step reads
 * its source under whichever name it currently has, and `legacy_*` is that name,
 * so a run would transform the migration-day copy and leave the restore exactly
 * where it is.
 *
 * Read off the `legacy_*` names that are actually there rather than off the list
 * of collections this migration knows, because the question is about a pair of
 * names and not about what either of them holds.
 */
export const twoGenerationsOfOldData = async (db: mongo.Db): Promise<string[]> => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort();
  const present = new Set(names);

  const found: string[] = [];
  for (const name of names.filter(name => name.startsWith(LEGACY_PREFIX)).map(name => name.slice(LEGACY_PREFIX.length))) {
    if (present.has(name) && (await holdsWhatThePreviousReleaseWrote(db, name))) found.push(name);
  }
  return found;
};

/**
 * What the boot and the check both say about that database, written once so they
 * cannot say different things about it.
 *
 * It is the one refusal whose whole point is the advice under it. The
 * stale-record refusal above ends with "drop `migrations` and `migrationLock`,
 * then start again", which is right where there is one generation of the old
 * data and quietly wrong where there are two: following it here migrates the
 * migration-day copy and leaves the restore somebody has just performed
 * standing, unread, in a database that now looks migrated. Its message is the
 * whole reason, so whatever prints an error prints it.
 */
export class TwoGenerationsOfOldData extends Error {
  constructor(public readonly collections: string[]) {
    super(
      [
        `Refusing to start: ${collections.join(', ')} hold what the previous release wrote, and so do legacy_${collections.join(', legacy_')}.`,
        '',
        'This database carries two generations of the old data at once, which is what a dump taken before the upgrade looks like once it has',
        'been restored over a migrated database: `mongorestore --drop` drops only the collections its archive carries, so what the migration',
        'had moved aside on the day survives beside what was just restored. Nothing in the data says which of the two is the one to keep.',
        '',
        'Migrating would transform the migration-day copy and leave the restore standing untouched, because a step reads its source under',
        'whichever name it currently has and `legacy_*` is that name. Dropping `migrations` and `migrationLock` and starting again does',
        'exactly that, so on this database it is not the way out.',
        '',
        'Decide which of the two copies is authoritative and drop the other - one name and its `legacy_` twin are read as the same',
        'collection, so one of them has to go. Then drop `migrations` and `migrationLock` and start again.',
      ].join('\n'),
    );
    this.name = 'TwoGenerationsOfOldData';
  }
}

export const unmigratedCollections = async (db: mongo.Db): Promise<string[]> => {
  const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name));

  const found: string[] = [];
  for (const collection of Object.values(LEGACY)) {
    if (!present.has(collection)) continue;
    if (await holdsWhatThePreviousReleaseWrote(db, collection)) found.push(collection);
  }
  return found;
};

/**
 * Every check, over the collections under whichever name they currently have.
 *
 * The context is a dry-run one: it resolves `legacy_users` where a run that was
 * killed has already moved it aside, and it can write nothing at all.
 */
export const preflight = async (db: mongo.Db): Promise<PreflightReport> => {
  const context = new MigrationContext(db, true, new Date());
  const owned = await devicesPerOwner(context);

  const checks = [
    () => duplicateUserIds(context, owned),
    () => duplicateAddresses(context, owned),
    () => duplicateDeviceIds(context),
    () => duplicateBrokerUsernames(context),
    () => duplicateClaimCodes(context),
    () => severalCodesPerDevice(context),
    () => duplicateFirmwareFiles(context),
    () => collidingPictures(context),
    () => devicesWithoutAnOwner(context),
    () => templatesWithoutAnOwner(context),
  ];

  const problems: PreflightProblem[] = [];
  for (const check of checks) {
    const problem = await check();
    if (problem) problems.push(problem);
  }

  return { problems, rows: problems.reduce((total, problem) => total + problem.groups.reduce((rows, group) => rows + group.rows.length, 0), 0) };
};

export const formatPreflight = (report: PreflightReport): string => {
  const lines = [
    'The database cannot be migrated as it is, and nothing has been written.',
    '',
    'Each of these is two or more rows that claim to be one thing, or a row that points at one that is not there.',
    'Which of them is right is not in the data, so they are resolved in the database by hand and the migration is run again.',
  ];

  report.problems.forEach((problem, index) => {
    lines.push('', `${index + 1}. ${problem.what}`, `   Breaks: ${problem.breaks}`);

    for (const group of problem.groups) {
      lines.push(`   ${group.value}`);
      for (const row of group.rows) lines.push(`     _id ${row.id}  ${row.facts.join(', ')}`);
    }

    if (problem.capped) lines.push(`   ... and more; the first ${GROUP_LIMIT} are listed.`);
  });

  lines.push('', `${plural(report.problems.length, 'problem')}, ${plural(report.rows, 'row')} in total.`);
  return lines.join('\n');
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

interface RawRow {
  id: string;
  [fact: string]: unknown;
}

/** How every transform reads a stored string, so a key grouped by it is the key a transform would write. */
const trimmed = (field: string): mongo.Document => ({ $trim: { input: `$${field}` } });

/**
 * The rows of one collection that share a value, counted in the collection
 * itself rather than asked of an index that may never have been built.
 */
const duplicates = async (
  source: mongo.Collection,
  key: mongo.Document,
  /** What the report tells the rows apart by, as the field paths or expressions the group pushes. */
  facts: Record<string, unknown>,
  where: mongo.Filter<mongo.Document> = {},
): Promise<{ groups: { value: string; rows: RawRow[] }[]; capped: boolean }> => {
  const found = await source
    .aggregate<{ _id: unknown; rows: RawRow[] }>(
      [
        { $match: where },
        { $group: { _id: key, rows: { $push: { id: { $toString: '$_id' }, ...facts } } } },
        // A value that is empty or absent names nothing - every transform reads
        // it as "there is none" - so two rows carrying it are not a pair.
        { $match: { _id: { $nin: [null, ''] }, 'rows.1': { $exists: true } } },
        { $sort: { _id: 1 } },
        { $limit: GROUP_LIMIT + 1 },
      ],
      // A collection of millions is grouped rather than failed on.
      { allowDiskUse: true },
    )
    .toArray();

  return {
    groups: found.slice(0, GROUP_LIMIT).map(group => ({ value: String(group._id), rows: group.rows })),
    capped: found.length > GROUP_LIMIT,
  };
};

const problemOf = (what: string, breaks: string, groups: PreflightGroup[], capped: boolean): PreflightProblem | null =>
  groups.length === 0 ? null : { what, breaks, groups, capped };

/** The stored value in quotes, so a difference that is only case or space can be seen. */
const asStored = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : 'none');

const day = (when: Date): string => when.toISOString().slice(0, 10);

/** When the document was written, which is also the date the migration would give it. */
const created = (id: string): string => (mongo.ObjectId.isValid(id) ? `created ${day(new mongo.ObjectId(id).getTimestamp())}` : 'no creation date');

const lastSeen = (value: unknown): string => {
  const at = instantOf(numberOf(value));
  return at ? `last seen ${day(at)}` : 'never seen';
};

const named = (value: unknown, fallback: string): string => textOf(value as string | undefined) ?? fallback;

/** How many devices each account answers for, which is what a decision between two accounts turns on. */
const devicesPerOwner = async (context: MigrationContext): Promise<Map<string, number>> => {
  const devices = await context.source(LEGACY.devices);
  const counted = await devices.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: '$owner_id', count: { $sum: 1 } } }]).toArray();

  const perOwner = new Map<string, number>();
  for (const entry of counted) {
    const owner = textOf(entry._id as string | undefined);
    if (owner) perOwner.set(owner, (perOwner.get(owner) ?? 0) + entry.count);
  }
  return perOwner;
};

/** What a decision between two accounts turns on: which address, how old, whether it was ever activated, how much it owns. */
const accountRow = (row: RawRow, devices: number): PreflightRow => ({
  id: row.id,
  facts: [asStored(row.email), created(row.id), flagOf(row.active) ? 'active' : 'not activated', `owns ${plural(devices, 'device')}`],
});

const duplicateUserIds = async (context: MigrationContext, owned: Map<string, number>): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(await context.source(LEGACY.users), trimmed('user_id'), { email: '$username', active: '$is_active' });

  return problemOf(
    'Two or more accounts share one user_id.',
    'Every device, grow, entry and picture names its owner by that id, so the accounts would be copied into one row and nothing can say which of them owns what.',
    groups.map(group => ({ value: `user_id ${group.value}`, rows: group.rows.map(row => accountRow(row, owned.get(group.value) ?? 0)) })),
    capped,
  );
};

/**
 * Two accounts under one address, where "one address" is what a person calls one:
 * the migration trims, so two that differ only in spaces collide on the unique
 * index and one of them is not migrated at all - and two that differ only in case
 * pass that index and are still one address to everybody who types it.
 */
const duplicateAddresses = async (context: MigrationContext, owned: Map<string, number>): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(
    await context.source(LEGACY.users),
    { $toLower: trimmed('username') },
    {
      email: '$username',
      owner: '$user_id',
      active: '$is_active',
    },
  );

  return problemOf(
    'Two or more accounts share one e-mail address.',
    'The address is what an account signs in by and is unique in the new model, so at most one of these is migrated and whatever the others own is left pointing at an account that is not there.',
    groups.map(group => ({
      value: `e-mail ${group.value}`,
      rows: group.rows.map(row => {
        const account = accountRow(row, owned.get(named(row.owner, '')) ?? 0);
        return { ...account, facts: [`user_id ${named(row.owner, 'none')}`, ...account.facts] };
      }),
    })),
    capped,
  );
};

const duplicateDeviceIds = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(await context.source(LEGACY.devices), trimmed('device_id'), {
    name: '$name',
    owner: '$owner_id',
    type: '$device_type',
    seen: '$lastseen',
  });

  return problemOf(
    'Two or more devices share one device_id.',
    'The device, the space it stands in, its plan and its camera are all named by that id, so the second row would overwrite the first and one of the two devices is gone with its configuration, its alarms and its pictures.',
    groups.map(group => ({
      value: `device_id ${group.value}`,
      rows: group.rows.map(row => ({
        id: row.id,
        facts: [named(row.name, 'no name'), named(row.type, 'no type'), `owner ${named(row.owner, 'nobody')}`, created(row.id), lastSeen(row.seen)],
      })),
    })),
    capped,
  );
};

const duplicateBrokerUsernames = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(
    await context.source(LEGACY.devices),
    trimmed('username'),
    { device: '$device_id', name: '$name', owner: '$owner_id', seen: '$lastseen' },
    // A device row made by hand has no credentials until it registers, and the
    // transform writes none for it either.
    { password: { $type: 'string', $ne: '' } },
  );

  return problemOf(
    'Two or more devices share one broker username.',
    'The new model holds that username unique, because it is what the broker looks a device up by, so the second device is not migrated and never connects again.',
    groups.map(group => ({
      value: `MQTT username ${group.value}`,
      rows: group.rows.map(row => ({
        id: row.id,
        facts: [`device ${named(row.device, 'none')}`, named(row.name, 'no name'), `owner ${named(row.owner, 'nobody')}`, lastSeen(row.seen)],
      })),
    })),
    capped,
  );
};

const duplicateClaimCodes = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(await context.source(LEGACY.claimCodes), trimmed('claim_code'), { device: '$device_id' });

  return problemOf(
    'Two or more claim code rows share one code.',
    'A code is unique in the new model, so only the first of them is migrated and the other devices can never be claimed.',
    groups.map(group => ({
      value: `claim code ${group.value}`,
      rows: group.rows.map(row => ({ id: row.id, facts: [`device ${named(row.device, 'none')}`, created(row.id)] })),
    })),
    capped,
  );
};

const severalCodesPerDevice = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(await context.source(LEGACY.claimCodes), trimmed('device_id'), { code: '$claim_code' });

  return problemOf(
    'A device has more than one claim code.',
    'A device has exactly one code in the new model and the row is named by the device, so the codes collapse into one and whichever is written last is the only one that still claims it.',
    groups.map(group => ({
      value: `device ${group.value}`,
      rows: group.rows.map(row => ({ id: row.id, facts: [`code ${asStored(row.code)}`, created(row.id)] })),
    })),
    capped,
  );
};

const duplicateFirmwareFiles = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await duplicates(
    await context.source(LEGACY.deviceFirmwareBinaries),
    { $concat: [trimmed('firmware_id'), ' / ', trimmed('name')] },
    { bytes: { $cond: [{ $eq: [{ $type: '$data' }, 'binData'] }, { $binarySize: '$data' }, null] } },
  );

  return problemOf(
    'Two or more firmware files share one name under one build.',
    'A file is named by its build and its name, so the rows collapse into one and a device would be sent whichever image happened to be written last.',
    groups.map(group => ({
      value: `build / file ${group.value}`,
      rows: group.rows.map(row => ({ id: row.id, facts: [typeof row.bytes === 'number' ? `${row.bytes} bytes` : 'no bytes', created(row.id)] })),
    })),
    capped,
  );
};

/**
 * Two pictures of one camera at one instant, which the new model holds unique
 * per camera, kind and window. Only the devices that become a camera: a picture
 * of a device nobody ever claimed is migrated without one and falls outside that
 * index.
 */
const collidingPictures = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const facts = await loadDeviceFacts(context);
  const { groups, capped } = await duplicates(
    await context.source(LEGACY.images),
    { $concat: [trimmed('device_id'), ':', '$format', ':', { $ifNull: ['$duration', ''] }, ':', { $toString: '$timestamp' }] },
    { picture: '$image_id', device: '$device_id', kind: '$format', window: '$duration', at: '$timestamp', bytes: '$size' },
    // A `user/jpeg` is a photo somebody uploaded and belongs to no camera; a
    // picture without an instant is rejected by the transform rather than written.
    { format: { $in: ['jpeg', 'mp4'] }, timestamp: { $gt: 0 } },
  );

  const withCamera = groups.filter(group => facts.get(named(group.rows[0].device, ''))?.cameraId != null);

  return problemOf(
    'Two or more pictures of one camera share an instant.',
    'A camera has one picture of a kind per instant in the new model, so the second is refused and its bytes stay in the store with nothing left pointing at them.',
    withCamera.map(group => ({
      value:
        `camera of ${named(group.rows[0].device, 'none')}, ${named(group.rows[0].kind, 'unknown')}` + windowOf(group.rows[0]) + atOf(group.rows[0]),
      rows: group.rows.map(row => ({
        id: row.id,
        facts: [`picture ${asStored(row.picture)}`, typeof row.bytes === 'number' ? `${row.bytes} bytes` : 'size unrecorded', created(row.id)],
      })),
    })),
    capped,
  );
};

const windowOf = (row: RawRow): string => (textOf(row.window as string | undefined) ? ` over ${String(row.window)}` : '');

const atOf = (row: RawRow): string => {
  const at = instantOf(numberOf(row.at));
  return at ? ` at ${at.toISOString()}` : '';
};

/**
 * The rows of a collection whose `owner_id` no account answers to. An account
 * the transform itself drops - one without an address or a password, which
 * cannot sign in and has no owner to be - is as absent as one that was never
 * there.
 */
const missingOwners = async (
  context: MigrationContext,
  collection: string,
): Promise<{ groups: { value: string; rows: mongo.Document[] }[]; capped: boolean }> => {
  const users = await context.source(LEGACY.users);
  const accounts = await users
    .find({ username: { $type: 'string', $ne: '' }, password: { $type: 'string', $ne: '' } }, { projection: { user_id: 1 } })
    .toArray();
  const known = new Set(accounts.map(account => textOf(account.user_id as string | undefined)).filter((id): id is string => id !== null));

  const source = await context.source(collection);
  const owners = (await source.distinct('owner_id')).filter((value): value is string => typeof value === 'string' && textOf(value) !== null);
  const missing = owners.filter(owner => !known.has(textOf(owner) as string));
  if (missing.length === 0) return { groups: [], capped: false };

  const rows = await source
    .find({ owner_id: { $in: missing.slice(0, GROUP_LIMIT) } })
    .limit(ROW_LIMIT)
    .toArray();

  const byOwner = new Map<string, mongo.Document[]>();
  for (const row of rows) byOwner.set(String(row.owner_id), [...(byOwner.get(String(row.owner_id)) ?? []), row]);

  return {
    groups: [...byOwner].map(([owner, owned]) => ({ value: `owner_id ${asStored(owner)}`, rows: owned })),
    capped: missing.length > GROUP_LIMIT,
  };
};

const devicesWithoutAnOwner = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await missingOwners(context, LEGACY.devices);

  return problemOf(
    'A device is claimed by an account that is not in the database.',
    'The device becomes a space owned by an account nobody can sign in to, and its grows, entries and pictures all point at the same nobody.',
    groups.map(group => ({
      value: group.value,
      rows: group.rows.map(row => ({
        id: String(row._id),
        facts: [`device ${named(row.device_id, 'none')}`, named(row.name, 'no name'), created(String(row._id)), lastSeen(row.lastseen)],
      })),
    })),
    capped,
  );
};

const templatesWithoutAnOwner = async (context: MigrationContext): Promise<PreflightProblem | null> => {
  const { groups, capped } = await missingOwners(context, LEGACY.recipeTemplates);

  return problemOf(
    'A plan template is owned by an account that is not in the database.',
    'The template is migrated into a library nobody can open, and a template nobody can reach is one nobody can delete either.',
    groups.map(group => ({
      value: group.value,
      rows: group.rows.map(row => ({
        id: String(row._id),
        facts: [named(row.name, 'no name'), flagOf(row.public) ? 'public' : 'private', created(String(row._id))],
      })),
    })),
    capped,
  );
};
