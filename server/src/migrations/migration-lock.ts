import { hostname } from 'node:os';
import { mongo } from 'mongoose';
import { logger } from '@utils/logger';

/**
 * One instance at a time.
 *
 * Two servers started together would otherwise both rename a collection aside
 * and both transform it, and the second rename is the one that fails - after
 * the first has already begun writing. So the lock is taken before the pending
 * list is even read: the instance that waits finds every migration applied and
 * carries on booting, which is the whole point of waiting rather than failing.
 *
 * The lease is short and renewed while the run goes on, so an instance that was
 * killed mid-migration does not lock the next one out for ever. Renewing is what
 * makes a long transform safe: the lease says "somebody is still working", not
 * "this will be done by then".
 */

const COLLECTION = 'migrationLock';
const LOCK_ID = 'migrations';

const LEASE_MS = 60_000;
const RENEW_EVERY_MS = 20_000;
const POLL_EVERY_MS = 2_000;

/** Long enough for the largest transform of a hosted database, short enough that a wedged boot is noticed. */
const WAIT_LIMIT_MS = 30 * 60_000;

interface LockDocument {
  _id: string;
  owner: string;
  takenAt: Date;
  expiresAt: Date;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms).unref());

export class MigrationLock {
  private constructor(
    private readonly locks: mongo.Collection<LockDocument>,
    private readonly owner: string,
    private readonly renewal: NodeJS.Timeout,
  ) {}

  public static async acquire(db: mongo.Db): Promise<MigrationLock> {
    const locks = db.collection<LockDocument>(COLLECTION);
    const owner = `${hostname()}:${process.pid}:${Date.now()}`;
    const until = Date.now() + WAIT_LIMIT_MS;
    let waited = false;

    for (;;) {
      // A lease nobody renewed belongs to an instance that is gone.
      await locks.deleteOne({ _id: LOCK_ID, expiresAt: { $lte: new Date() } });

      try {
        await locks.insertOne({ _id: LOCK_ID, owner, takenAt: new Date(), expiresAt: new Date(Date.now() + LEASE_MS) });
        if (waited) logger.info('Migrations: the lock was released by the instance that held it');

        const renewal = setInterval(() => {
          locks
            .updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(Date.now() + LEASE_MS) } })
            .catch(error => logger.error(`Migrations: renewing the lock failed: ${error}`));
        }, RENEW_EVERY_MS);
        renewal.unref();

        return new MigrationLock(locks, owner, renewal);
      } catch (error) {
        if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) throw error;
      }

      if (Date.now() >= until) throw new Error('Migrations: another instance has held the migration lock for too long');

      if (!waited) {
        waited = true;
        logger.info('Migrations: another instance is migrating; waiting for it to finish');
      }
      await sleep(POLL_EVERY_MS);
    }
  }

  public async release(): Promise<void> {
    clearInterval(this.renewal);
    // By owner: a lease that expired and was taken by somebody else is not ours to drop.
    await this.locks.deleteOne({ _id: LOCK_ID, owner: this.owner });
  }
}
