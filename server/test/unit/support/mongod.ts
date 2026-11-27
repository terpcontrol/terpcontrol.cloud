import { MongoMemoryServer } from 'mongodb-memory-server';

/** How long a spec file's mongod may take to come up (`startMongod`). */
const START_MS = 60_000;

/**
 * The time of a `beforeAll` that starts a mongod and readies a database on it: the start's minute, and as long again
 * for its collections and indexes, which a busy drive held up for more than a minute.
 */
export const MONGOD_HOOK_MS = 3 * 60_000;

/**
 * Starts a spec file's mongod, with a minute to come up where
 * mongodb-memory-server gives it ten seconds.
 *
 * jest begins a spec file in every worker at once and each starts a mongod of
 * its own, so a run opens with a dozen starting together; on a machine that is
 * busy besides - another suite, a type check, a browser - one of them took more
 * than ten seconds to say it was listening. The start then threw "Instance
 * failed to start within 10000ms" in the file's `beforeAll`, and every test of
 * the file failed with it.
 * A slow start is not a broken one, so it is waited for; the hook that calls
 * this takes `MONGOD_HOOK_MS`, or jest's own 30 s would cut it short instead.
 *
 * The port is one the library found free a moment before mongod binds it, and
 * among so many starts another process now and then takes it in between
 * ('Port "50000" already in use'): that start is tried again on another.
 */
export const startMongod = async (tries = 3): Promise<MongoMemoryServer> => {
  try {
    return await MongoMemoryServer.create({ instance: { launchTimeout: START_MS } });
  } catch (error) {
    if (tries <= 1 || !/already in use/.test(String((error as Error)?.message))) throw error;
    return startMongod(tries - 1);
  }
};

/**
 * Stops a spec file's mongod by killing it, where `server.stop()` alone would
 * ask it to shut down cleanly.
 *
 * mongodb-memory-server sends SIGINT and gives mongod ten seconds before it
 * falls back to SIGKILL. A clean shutdown ends in a WiredTiger checkpoint that
 * syncs every table file - some 150 for the `/v1` collections and their
 * indexes, each an F_FULLFSYNC on macOS - so how long it takes depends on what
 * else is flushing the drive at that moment, and with a dozen spec files
 * stopping theirs at once it regularly took longer than that. The database is
 * deleted as soon as it stops and never has to survive a crash, so the
 * checkpoint protects nothing; killed, mongod is gone within milliseconds
 * whatever the disk is doing. `stop()` then finds it exiting, and still
 * removes the killer process and the data directory.
 */
export const stopMongod = async (server: MongoMemoryServer | undefined): Promise<void> => {
  server?.instanceInfo?.instance.mongodProcess?.kill('SIGKILL');
  await server?.stop();
};
