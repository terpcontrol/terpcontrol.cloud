import 'reflect-metadata';
import { config as readEnvFile } from 'dotenv';
import { Connection, createConnection } from 'mongoose';
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
 * `--rollback` prints what it would drop, restore and leave standing, and needs
 * `--confirm` beside it to do any of it.
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

/**
 * The plan first, and the work only when it is asked for a second time.
 *
 * A rollback drops collections and loses everything written since the migration,
 * and on a database whose run stopped part way it also has to say what it is
 * *not* touching - the collections no step reached are the ones the old rule
 * destroyed. That is a plan to read, so printing it and acting on it cannot be
 * the same command.
 */
const rollback = async (connection: Connection, confirmed: boolean): Promise<void> => {
  const db = connection.db!;
  const plan = await planRollback(db);
  const { applied, pending } = await new MigrationRunner(connection).progress();

  const stoppedAfter = applied.length > 0 ? `stopped after ${applied[applied.length - 1]}` : 'recorded no step at all';
  report(
    pending.length === 0
      ? '\nRolling back a database every migration has run on.'
      : `\nRolling back a database whose run ${stoppedAfter}: ${pending.length} of ${applied.length + pending.length} migrations never ran.`,
  );
  report('Everything written since the migration is lost.\n');

  report(`Dropping (${plan.drop.length}): ${plan.drop.join(', ') || 'nothing'}`);
  report(`Restoring (${plan.restore.length}): ${plan.restore.map(entry => `${entry.from} -> ${entry.to}`).join(', ') || 'nothing'}`);

  if (plan.leftStanding.old.length > 0) {
    report(`Left exactly as they are (${plan.leftStanding.old.length}): ${plan.leftStanding.old.join(', ')}`);
    report('  Nothing moved these aside, so they stand exactly where the previous release left them and nothing holds a second copy.');
  }
  if (plan.leftStanding.unrecognised.length > 0) {
    report(`Not recognised, and therefore not touched: ${plan.leftStanding.unrecognised.join(', ')}`);
    report('  This command drops only what this release registers a model for. Anything else is yours to look at.');
  }

  if (!confirmed) {
    report('\nNothing has been written. Run it again with --confirm to do all of the above.');
    return;
  }

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
      await rollback(connection, process.argv.includes('--confirm'));
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
