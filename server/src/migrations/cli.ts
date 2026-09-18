import 'reflect-metadata';
import { config as readEnvFile } from 'dotenv';
import { createConnection } from 'mongoose';
import { databaseConfig } from '../config/configuration';
import { mongoConnectionSettings } from '../database/mongo-connection';
import { MigrationRunner, MigrationRunReport } from './migration-runner';
import { applyRollback, planRollback } from './migration-rollback';
import { PreflightFailure, preflight } from './preflight';

/**
 * `npm run migrate`, its `--dry-run` and `--check`, and `npm run migrate:rollback`.
 *
 * The server applies the migrations itself at boot, so this is not how an
 * upgrade happens - it is how a rehearsal happens. A dry run reads the whole
 * database, runs every transform and writes nothing at all, not even the rename,
 * and prints the counts and the rejects an operator reads before letting the
 * real thing run against the hosted database. `--check` is the short half of
 * that: only the checks a run refuses to start on, so a database can be cleared
 * for an upgrade before the day of it.
 *
 * It opens its own connection rather than building the application: the
 * migrations need the database and nothing else, and booting the server to run
 * them would start the broker connection and every timer with it.
 */

const report = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const printRun = (result: MigrationRunReport): void => {
  report(result.dryRun ? '\nDry run: nothing was written.\n' : '\nMigrations applied.\n');

  if (result.alreadyApplied.length > 0) report(`Already applied: ${result.alreadyApplied.join(', ')}`);

  for (const outcome of result.applied) {
    report(`\n${outcome.name} (${outcome.durationMs} ms)`);
    for (const [key, value] of Object.entries(outcome.stats)) {
      if (value !== 0) report(`  ${key}: ${value}`);
    }
    for (const reject of outcome.rejects) {
      report(`  ${reject.dropped ? 'dropped' : 'kept'} ${reject.source}/${reject.id}: ${reject.reason}${reject.detail ? ` [${reject.detail}]` : ''}`);
    }
    if (outcome.rejectCount > outcome.rejects.length) {
      report(`  ... and ${outcome.rejectCount - outcome.rejects.length} further reject(s); the whole list is in the log`);
    }
  }

  if (result.applied.length === 0) report('\nNothing to do.');
};

const rollback = async (db: Parameters<typeof planRollback>[0]): Promise<void> => {
  const plan = await planRollback(db);

  report('\nRolling back. Everything written since the migration is lost.\n');
  report(`Dropping: ${plan.drop.join(', ') || 'nothing'}`);
  report(`Restoring: ${plan.restore.map(entry => `${entry.from} -> ${entry.to}`).join(', ')}`);

  await applyRollback(db, plan);
  report('\nDone. The previous release runs on exactly the data it left.');
};

const main = async (): Promise<void> => {
  // The same file the server reads, so a local rehearsal is configured the same way.
  readEnvFile({ path: `.env.${process.env.NODE_ENV || 'development'}.local` });

  const settings = mongoConnectionSettings(databaseConfig());
  const { uri, ...options } = settings;
  const connection = createConnection(uri, options);
  await connection.asPromise();

  try {
    if (process.argv.includes('--rollback')) {
      await rollback(connection.db!);
      return;
    }

    if (process.argv.includes('--check')) {
      const found = await preflight(connection.db!);
      if (found.problems.length > 0) throw new PreflightFailure(found);

      report('\nNothing stands in the way of a migration.');
      return;
    }

    printRun(await new MigrationRunner(connection).run({ dryRun: process.argv.includes('--dry-run') }));
  } finally {
    await connection.close();
  }
};

/** A failed check is a report to read, not a crash: it prints as it was written, with no stack in front of it. */
const reasonFor = (error: unknown): string => {
  if (error instanceof PreflightFailure) return error.message;
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
};

main().catch(error => {
  process.stderr.write(`${reasonFor(error)}\n`);
  process.exit(1);
});
