import { mongo } from 'mongoose';
import { IMAGE_BUCKET_NAME } from '@database/image-store';
import { LEGACY_PREFIX } from './migration';

/**
 * The way back for one release: drop what the migration built and put the old
 * collections back under the names the previous release reads.
 *
 * **Everything written since the migration is lost**, which is what going back
 * means: the old collections have stood untouched since the day of it, and the
 * new ones are what has been written into since. Picture bytes written meanwhile
 * become orphans, which the existing sweep removes.
 *
 * What is dropped is decided by exclusion rather than by a list of the new
 * collections: everything that is not `legacy_*` and not the picture bucket. A
 * list is a thing to forget a name from, and forgetting one here would leave a
 * collection of the new model standing in a database the old release is about to
 * write into. The bucket is what the migration never rewrote and what the old
 * release reads by the very same file ids.
 *
 * It refuses when there is no `legacy_*` collection at all, because that is a
 * database that was never migrated - and dropping every collection of one would
 * be the worst thing this command could do.
 */

export interface RollbackPlan {
  /** Dropped, in this order, before anything is renamed back. */
  drop: string[];
  /** `legacy_<name>` back to `<name>`. */
  restore: { from: string; to: string }[];
}

const isBucket = (name: string): boolean => name === `${IMAGE_BUCKET_NAME}.files` || name === `${IMAGE_BUCKET_NAME}.chunks`;

export const planRollback = async (db: mongo.Db): Promise<RollbackPlan> => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).sort();
  const legacy = names.filter(name => name.startsWith(LEGACY_PREFIX));

  if (legacy.length === 0) {
    throw new Error('Nothing to roll back: this database holds no legacy_* collection, so the migration has never run on it.');
  }

  return {
    drop: names.filter(name => !name.startsWith(LEGACY_PREFIX) && !isBucket(name)),
    restore: legacy.map(name => ({ from: name, to: name.slice(LEGACY_PREFIX.length) })),
  };
};

export const applyRollback = async (db: mongo.Db, plan: RollbackPlan): Promise<void> => {
  // Every drop first: `legacy_users` cannot go back to `users` while a `users`
  // of the new model is still standing there.
  for (const name of plan.drop) await db.dropCollection(name);
  for (const { from, to } of plan.restore) await db.renameCollection(from, to);
};
