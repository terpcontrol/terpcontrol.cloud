import { mongo } from 'mongoose';
import { IMAGE_BUCKET_NAME } from '@database/image-store';
import { V1_COLLECTIONS } from '@database/models.module';
import { LEGACY } from './legacy';
import { LEGACY_PREFIX, legacyName } from './migration';
import { MIGRATION_LOCK_COLLECTION } from './migration-lock';
import { holdsWhatThePreviousReleaseWrote } from './preflight';

/**
 * The way back for one release: drop what the migration built and put the old
 * collections back under the names the previous release reads.
 *
 * **Everything written since the migration is lost**, which is what going back
 * means: the old collections have stood untouched since the day of it, and the
 * new ones are what has been written into since. Picture bytes written meanwhile
 * become orphans, which the existing sweep removes. What the first step did is
 * not undone either - the bytes it moved out of `images` stay in the bucket,
 * which is where the previous release reads them from by the very same ids.
 *
 * **It is defined for a run that stopped part way**, which is precisely when
 * somebody reaches for it. A step that has not run has not moved its sources, so
 * those collections are still standing under their original names with the only
 * copy of their data in them. That is why what may be dropped is a list derived
 * from the model's own registrations rather than everything that is not
 * `legacy_*`: that rule reads "nothing has renamed this aside" as "this release
 * built it", and on a half-migrated database it drops every collection no step
 * has reached - each of them the only copy of what is in it.
 *
 * A name missing from the derived list therefore leaves a collection of the new
 * model standing in a database the old release is about to write into - which an
 * operator reads off the "left standing" line and drops by hand. That is a
 * report; the failure the other way round is a restore from the backup. And the
 * list is not really hand-maintained: a collection with no registration is one
 * no service can read or write, and a spec asserts that a full run leaves
 * nothing standing outside it.
 *
 * It refuses twice. On a database that holds no `legacy_*` at all, because
 * nothing was ever moved aside and there is nothing to put back. And on one
 * holding two generations of the old data at once - a pre-upgrade dump restored
 * over a migrated database leaves `devicelogs` beside `legacy_devicelogs`, with
 * nothing in the data saying which of them is authoritative.
 */

/** A refusal is a report to read rather than a crash, so it prints as it was written, with no stack in front of it. */
export class RollbackRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackRefused';
  }
}

export interface RollbackPlan {
  /** Dropped, in this order, before anything is renamed back. */
  drop: string[];
  /** `legacy_<name>` back to `<name>`. */
  restore: { from: string; to: string }[];
  /** Present, dropped by nothing and restored over by nothing. Reported, never touched. */
  leftStanding: {
    /** Old collections nothing moved aside: the ones no step reached, and the ones that were empty on the day. */
    old: string[];
    /** Anything this command does not recognise at all. */
    unrecognised: string[];
  };
}

/** What this release builds, and therefore the whole of what a rollback may drop. */
export const BUILT_BY_THIS_RELEASE: ReadonlySet<string> = new Set([...V1_COLLECTIONS, MIGRATION_LOCK_COLLECTION]);

/** The names the previous release stores its own documents under. Two of them are also names this release uses. */
const LEGACY_NAMES: ReadonlySet<string> = new Set(Object.values(LEGACY));

const isBucket = (name: string): boolean => name === `${IMAGE_BUCKET_NAME}.files` || name === `${IMAGE_BUCKET_NAME}.chunks`;

export const planRollback = async (db: mongo.Db, built: ReadonlySet<string> = BUILT_BY_THIS_RELEASE): Promise<RollbackPlan> => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort();
  const present = new Set(names);
  const legacy = names.filter(name => name.startsWith(LEGACY_PREFIX));

  if (legacy.length === 0) {
    throw new RollbackRefused(
      [
        'Nothing to roll back: this database holds no legacy_* collection, so nothing was ever moved aside and there is nothing to put back.',
        '',
        'That is a database the migration has never run on - and on an install that had no old data at all, one where it ran and found',
        'nothing to move. Either way the previous release reads what is already there.',
      ].join('\n'),
    );
  }

  // Two generations of the old data at once: a dump taken before the upgrade,
  // restored over a database that had already been migrated. A rename leaves a
  // collection under one name only, so this cannot happen to a run that merely
  // stopped part way - and which of the two copies is the one to keep is not in
  // the data.
  const twoGenerations: string[] = [];
  const inTheWay: string[] = [];
  for (const name of legacy.map(name => name.slice(LEGACY_PREFIX.length))) {
    if (!present.has(name)) continue;
    if (await holdsWhatThePreviousReleaseWrote(db, name)) {
      twoGenerations.push(name);
      continue;
    }
    // Standing where a `legacy_*` has to go back and holding nothing of the
    // previous release: this release's own collection, or an empty one left
    // behind. Either has to go for the rename to have somewhere to land, and
    // neither is anything to lose. Anything else is left where it is and the
    // rename fails loudly rather than taking rows nothing else holds.
    if (built.has(name) || (await db.collection(name).countDocuments({}, { limit: 1 })) === 0) inTheWay.push(name);
  }
  if (twoGenerations.length > 0) {
    throw new RollbackRefused(
      [
        `Refusing to roll back: ${twoGenerations.join(', ')} hold what the previous release wrote, and so do legacy_${twoGenerations.join(', legacy_')}.`,
        '',
        'This database carries two generations of the old data at once, which is what a dump taken before the upgrade looks like once it has',
        'been restored over a migrated database: `mongorestore --drop` drops only the collections its archive carries, so what the migration',
        'had moved aside on the day survives beside what was just restored. Nothing in the data says which of the two is the one to keep, and',
        'rolling back would rename the migration-day copy over the restore that was just performed.',
        '',
        'The server refuses to start on this database for the same reason. Decide which copy is authoritative, keep it, drop the other, then',
        'drop `migrations` and `migrationLock` and start again.',
      ].join('\n'),
    );
  }

  // Of the names this release builds, the two it shares with the previous one
  // are only its own where the rename has actually happened. Without that
  // pairing a run that stopped after `002-users` would drop `devices` - the only
  // copy of every device, its configuration and its alarms.
  const dropped = new Set([...names.filter(name => built.has(name) && (!LEGACY_NAMES.has(name) || present.has(legacyName(name)))), ...inTheWay]);
  const drop = names.filter(name => dropped.has(name));
  const left = names.filter(name => !dropped.has(name) && !name.startsWith(LEGACY_PREFIX) && !isBucket(name));

  return {
    drop,
    restore: legacy.map(name => ({ from: name, to: name.slice(LEGACY_PREFIX.length) })),
    leftStanding: {
      old: left.filter(name => LEGACY_NAMES.has(name)),
      unrecognised: left.filter(name => !LEGACY_NAMES.has(name)),
    },
  };
};

export const applyRollback = async (db: mongo.Db, plan: RollbackPlan): Promise<void> => {
  // Every drop first: `legacy_users` cannot go back to `users` while a `users`
  // of the new model is still standing there.
  for (const name of plan.drop) await db.dropCollection(name);
  for (const { from, to } of plan.restore) await db.renameCollection(from, to);
};
