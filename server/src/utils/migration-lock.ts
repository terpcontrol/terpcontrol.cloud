import migrationModel from '@models/migration.model';
import { logger } from '@utils/logger';

// A run that died without releasing the lock must not block the migration
// forever; after this long another process may take it over.
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Runs a boot-time migration on exactly one process. Several application
 * instances start at the same moment, so the guard has to be a single atomic
 * write rather than a read followed by a write.
 */
export async function withMigrationLock(name: string, run: () => Promise<void>): Promise<boolean> {
  // The guard below is only a guard once the unique index exists, and index
  // builds do not block startup — so wait for it rather than race it.
  await migrationModel.createIndexes();

  try {
    await migrationModel.findOneAndUpdate(
      { name, $or: [{ laeuft_seit: null }, { laeuft_seit: { $lt: Date.now() - STALE_AFTER_MS } }] },
      { $set: { laeuft_seit: Date.now() } },
      { upsert: true },
    );
  } catch (error) {
    // The unique name turns a lost race into a duplicate key: someone else runs it.
    return false;
  }

  try {
    await run();
    await migrationModel.updateOne({ name }, { $set: { laeuft_seit: null, beendet_at: Date.now() } });
    return true;
  } catch (error) {
    logger.error(`Migration ${name} failed: ${error}`);
    await migrationModel.updateOne({ name }, { $set: { laeuft_seit: null } });
    return false;
  }
}
