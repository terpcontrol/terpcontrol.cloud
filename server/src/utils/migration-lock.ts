import { randomUUID } from 'crypto';
import migrationModel, { MigrationLock } from '@models/migration.model';
import { logger } from '@utils/logger';

// A run that died without releasing the lock must not block the migration
// forever; after this long another process may take it over.
const STALE_AFTER_MS = 15 * 60 * 1000;

// Best effort by design: a release that cannot be written leaves a lock that
// goes stale on its own, while throwing here would turn a finished migration
// into a failed boot.
const release = async (name: string, run_id: string, fields: Partial<MigrationLock>): Promise<void> => {
  try {
    await migrationModel.updateOne({ name: name, run_id: run_id }, { $set: fields });
  } catch (error) {
    logger.error(`Migration ${name} could not release its lock: ${error}`);
  }
};

/**
 * Runs a boot-time migration on exactly one process, and only until it has
 * succeeded once. Several instances start at the same moment, so the guard has
 * to be a single atomic write rather than a read followed by a write, and it
 * has to name the run holding it: a run whose lease went stale was already
 * replaced and must never clear its successor's lock.
 */
export async function withMigrationLock(name: string, run: () => Promise<void>): Promise<boolean> {
  const run_id = randomUUID();

  try {
    // The guard below is only a guard once the unique index exists, and index
    // builds do not block startup — so wait for it rather than race it.
    await migrationModel.createIndexes();
    await migrationModel.findOneAndUpdate(
      {
        name,
        beendet_at: null,
        $or: [{ laeuft_seit: null }, { laeuft_seit: { $lt: Date.now() - STALE_AFTER_MS } }],
      },
      { $set: { laeuft_seit: Date.now(), run_id: run_id } },
      { upsert: true },
    );
  } catch (error: any) {
    // A lost race and a finished migration both hit the unique name index;
    // anything else means the database itself could not answer.
    if (error?.code !== 11000) {
      logger.error(`Migration ${name} could not take the lock: ${error}`);
    }
    return false;
  }

  try {
    await run();
    await release(name, run_id, { laeuft_seit: null, beendet_at: Date.now() });
    return true;
  } catch (error) {
    logger.error(`Migration ${name} failed: ${error}`);
    await release(name, run_id, { laeuft_seit: null });
    return false;
  }
}
