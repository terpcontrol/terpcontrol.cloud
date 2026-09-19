import 'reflect-metadata';
import { config as readEnvFile } from 'dotenv';
import { Connection, createConnection } from 'mongoose';
import { V1_MODELS_MIGRATED_IN_PLACE, registerV1Models } from '@database/models.module';
import { databaseConfig } from '../config/configuration';
import { mongoConnectionSettings } from '../database/mongo-connection';
import { MigrationRunner, MigrationRunReport, documentsCopied, migrationFailureText, runProgress } from './migration-runner';
import { PreflightFailure, preflight } from './preflight';

/**
 * `npm run migrate`, its `--dry-run` and its `--check`.
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
 * There is no command here that undoes a run. The way back out of an upgrade is
 * the backup taken before it.
 *
 * It opens its own connection rather than building the application: the
 * migrations need the database and nothing else, and booting the server to run
 * them would start the broker connection and every timer with it. What it does
 * take from the application is the models, because their indexes are what makes
 * the copying the same speed here as it is at boot - see `likeABoot` below.
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

  if (result.dryRun && result.applied.length > 0) {
    // The rehearsal's duration is the only number anybody has for how long the
    // server is down during the upgrade, and it is not that number. Said here in
    // full, because the line the run itself printed has room for a clause.
    report(
      [
        '',
        'How long that took is not how long the upgrade takes. A rehearsal reads every row and runs every transform, and then writes none',
        `of it: the ${documentsCopied(result.applied)} documents above were each built and thrown away, where a real run upserts every one of them by \`id\`,`,
        'maintains the indexes of the collection it lands in, and renames the old collections aside first. The reading and the transforms',
        'are in the figure above and none of that writing is, so the upgrade takes longer than this by whatever those upserts cost - which',
        'is what a real run against a copy of the database measures and this one cannot.',
      ].join('\n'),
    );
  }
};

/**
 * The index state a boot starts from, on a connection that has no models at all.
 *
 * Every copy a migration makes is an upsert by `id`. At boot those land in
 * collections mongoose has already declared a unique `id` index on; here the
 * collection is created by the first write and carries `_id` and nothing else,
 * so every upsert after it is a scan of everything the step has written so far -
 * which is quadratic, and on the entries of a hosted database the difference
 * between minutes and a day.
 *
 * Awaited rather than left to `autoIndex`, because the point is that the index
 * is there before the first upsert rather than shortly afterwards. The two
 * collections that still hold the previous release's shapes are the exception
 * they are at boot: their documents carry none of the fields those unique
 * indexes are on, so they are registered and left alone, and the runner builds
 * them once the run has renamed the old rows aside.
 *
 * Only for a run that writes. A rehearsal writes nothing at all, and building an
 * index creates the collection it is on.
 */
const likeABoot = async (connection: Connection): Promise<void> => {
  for (const model of registerV1Models(connection)) {
    if (V1_MODELS_MIGRATED_IN_PLACE.includes(model.modelName)) continue;

    try {
      await model.createIndexes();
    } catch (error) {
      // As at boot: a missing index is slow, and refusing to migrate is worse.
      report(`Migrations: building the indexes of ${model.collection.collectionName} failed: ${error}`);
    }
  }
};

const main = async (): Promise<void> => {
  // The same file the server reads, so a local rehearsal is configured the same way.
  readEnvFile({ path: `.env.${process.env.NODE_ENV || 'development'}.local` });

  const settings = mongoConnectionSettings(databaseConfig());
  const { uri, ...options } = settings;
  const connection = createConnection(uri, options);
  await connection.asPromise();

  try {
    if (process.argv.includes('--check')) {
      // The database against itself and the record against the database, in the
      // order a run asks them: an answer about a database holding two copies of
      // the old data is an answer about neither of them.
      await new MigrationRunner(connection).refuseTwoGenerationsOfOldData();
      await new MigrationRunner(connection).refuseAStaleRecord();

      const found = await preflight(connection.db!);
      if (found.problems.length > 0) throw new PreflightFailure(found);

      report('\nNothing stands in the way of a migration.');
      return;
    }

    const dryRun = process.argv.includes('--dry-run');
    const runner = new MigrationRunner(connection);
    if (!dryRun) await likeABoot(connection);

    printRun(
      await runner.run({
        dryRun,
        allowRejects: process.argv.includes('--allow-rejects'),
        // The same lines the server writes at boot, as they happen: a dry run
        // over a hosted-size database is otherwise as silent as the boot was.
        watch: event => report(runProgress(event, dryRun).line),
      }),
    );

    // Where a boot ends: the two collections that held the old shapes have been
    // separated by now, so their indexes are built last, exactly as `runAtBoot`
    // builds them.
    if (!dryRun) await runner.buildSeparatedIndexes();
  } finally {
    await connection.close();
  }
};

main().catch(error => {
  process.stderr.write(`${migrationFailureText(error)}\n`);
  process.exit(1);
});
