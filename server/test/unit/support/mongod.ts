import type { MongoMemoryServer } from 'mongodb-memory-server';

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
