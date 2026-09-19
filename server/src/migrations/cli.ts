import 'reflect-metadata';
import { config as readEnvFile } from 'dotenv';
import { createConnection } from 'mongoose';
import { databaseConfig } from '../config/configuration';
import { mongoConnectionSettings } from '../database/mongo-connection';
import { MigrationRunner, MigrationRunReport, migrationFailureText, runProgress } from './migration-runner';
import { applyRollback, planRollback } from './migration-rollback';
import { PreflightFailure, preflight } from './preflight';

/**
 * `npm run migrate`, its `--dry-run` and `--check`, and `npm run migrate:rollback`.
 *
 * The server applies the migrations itself at boot, so this is not how an
 * upgrade happens - it is how a rehearsal happens. A dry run reads the whole
 * database, runs every transform and writes nothing at all, not even the rename,
 * and prints the counts and the rejects an operator reads before letting the
 * real thing run against the hosted database. `--allow-rejects` is how a run is
 * told that leaving the rows it cannot take behind is the intention. `--check` is the short half of
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

  // The counts are on the line each step printed as it finished; what is
  // gathered here is what an operator has to decide about.
  for (const outcome of result.applied) {
    if (outcome.rejects.length === 0) continue;

    report(`\n${outcome.name}`);
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
      // The record against the database first: a rehearsal that says the
      // migration has already run over a database still in the old shapes is
      // the one answer nobody would act on.
      await new MigrationRunner(connection).refuseAStaleRecord();

      const found = await preflight(connection.db!);
      if (found.problems.length > 0) throw new PreflightFailure(found);

      report('\nNothing stands in the way of a migration.');
      return;
    }

    const dryRun = process.argv.includes('--dry-run');
    printRun(
      await new MigrationRunner(connection).run({
        dryRun,
        allowRejects: process.argv.includes('--allow-rejects'),
        // The same lines the server writes at boot, as they happen: a dry run
        // over a hosted-size database is otherwise as silent as the boot was.
        watch: event => report(runProgress(event, dryRun).line),
      }),
    );
  } finally {
    await connection.close();
  }
};

main().catch(error => {
  process.stderr.write(`${migrationFailureText(error)}\n`);
  process.exit(1);
});
