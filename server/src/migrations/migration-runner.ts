import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import { V1_MODELS_MIGRATED_IN_PLACE } from '@database/models.module';
import { logger } from '@utils/logger';
import { derivedId } from './ids';
import { MigrationContext, MigrationReject, MigrationStep } from './migration';
import { MigrationLock } from './migration-lock';
import { PreflightFailure, preflight } from './preflight';
import { MIGRATION_STEPS } from './steps';

/** Where a run is recorded, and what says a migration has already been applied. */
const MIGRATIONS = 'migrations';

export interface MigrationOutcome {
  name: string;
  durationMs: number;
  stats: Record<string, number>;
  rejects: MigrationReject[];
  rejectCount: number;
}

/**
 * What a run throws when a transform could not take a row.
 *
 * It carries the step's whole outcome rather than a sentence, so whoever reads
 * it sees every row that step rejected and why - which is the thing to act on,
 * and the thing a count alone hides.
 */
export class RejectedRows extends Error {
  constructor(public readonly outcome: MigrationOutcome) {
    super(formatRejects(outcome));
    this.name = 'RejectedRows';
  }
}

/** The report a person reads: what was refused, why, and which row it was. */
const formatRejects = (outcome: MigrationOutcome): string => {
  const shown = outcome.rejects.map(reject => {
    const where = reject.detail ? ` (${reject.detail})` : '';
    const kept = reject.dropped ? 'not migrated' : 'migrated without it';
    return `  ${reject.source}/${reject.id}${where}\n    ${reject.reason}\n    ${kept}`;
  });
  const more = outcome.rejectCount > shown.length ? `\n  … and ${outcome.rejectCount - shown.length} more of the same kind.` : '';

  return [
    `${outcome.name} could not take ${outcome.rejectCount} row${outcome.rejectCount === 1 ? '' : 's'}, and the run stopped there.`,
    '',
    'What it was written after is kept, so fixing these and running again carries on rather than starting over.',
    'If leaving them behind is what you want, run again with --allow-rejects (MIGRATION_ALLOW_REJECTS=true at boot).',
    '',
    ...shown,
    more,
  ].join('\n');
};

export interface MigrationRunReport {
  dryRun: boolean;
  applied: MigrationOutcome[];
  /** Named rather than counted: an operator reading the report wants to see what was already there. */
  alreadyApplied: string[];
}

/**
 * Applies the migrations in order, once each.
 *
 * It runs at boot, before the server listens or subscribes to MQTT, so that
 * nothing reads or writes a collection while it is being renamed aside and
 * copied. A failure throws, which ends the boot: a half-migrated server serving
 * requests is the one outcome nothing here can reason about afterwards.
 */
@Injectable()
export class MigrationRunner {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get db(): mongo.Db {
    // Nest opens the connection before the first provider that needs it is
    // built, so the driver's handle is there by the time anything calls this.
    return this.connection.db!;
  }

  public async runAtBoot(): Promise<void> {
    // Nobody types a flag when a container starts, so the deliberate way past a
    // rejected row is set where the rest of the deployment is.
    const report = await this.run({ dryRun: false, allowRejects: process.env.MIGRATION_ALLOW_REJECTS === 'true' });
    for (const outcome of report.applied) {
      logger.info(`Migration ${outcome.name} applied in ${outcome.durationMs} ms: ${describe(outcome)}`);
    }

    await this.buildSeparatedIndexes();
  }

  public async run({ dryRun, allowRejects = false }: { dryRun: boolean; allowRejects?: boolean }): Promise<MigrationRunReport> {
    const applied = await this.appliedNames();
    const report: MigrationRunReport = { dryRun, applied: [], alreadyApplied: MIGRATION_STEPS.filter(s => applied.has(s.name)).map(s => s.name) };

    if (report.alreadyApplied.length === MIGRATION_STEPS.length) return report;

    // Before the lock and before any step, on a dry run as much as on a real
    // one: a database that holds two rows claiming to be one thing is not one to
    // half-migrate and ask about afterwards. Only where something is still
    // pending - a database every step has run on holds the new shapes, which
    // these checks say nothing about.
    const found = await preflight(this.db);
    if (found.problems.length > 0) throw new PreflightFailure(found);

    // Taken before the pending list is read again: the instance that waited for
    // it has just finished, and what it applied has to count as applied here.
    const lock = dryRun ? null : await MigrationLock.acquire(this.db);
    try {
      const alreadyApplied = dryRun ? applied : await this.appliedNames();
      report.alreadyApplied = MIGRATION_STEPS.filter(step => alreadyApplied.has(step.name)).map(step => step.name);

      for (const step of MIGRATION_STEPS) {
        if (alreadyApplied.has(step.name)) continue;

        const outcome = await this.apply(step, dryRun, allowRejects);
        report.applied.push(outcome);

        // A row a transform could not take is a row that will not be in the new
        // model, and a report nobody has to read is not a safeguard: an entry
        // rule that dropped every diary line anybody had ever written reported
        // each one and finished green. So the run stops here with what this step
        // rejected, and whoever reads it decides - fix the rows and run again,
        // or say with `allowRejects` that leaving them behind is the intention.
        // What was written stays: every copy is an upsert keyed by the document
        // it came from, so the next run carries on rather than starting over.
        if (!allowRejects && outcome.rejectCount > 0) throw new RejectedRows(outcome);
      }
    } finally {
      await lock?.release();
    }

    return report;
  }

  /**
   * `users` and `devices` are the two collections the migration rewrites under
   * their own name, so the models of them are registered with their index
   * building turned off (`database/models.module.ts`): mongoose starts a
   * model's builds as the model is compiled, which is before this runs, and an
   * unmigrated document carries none of the fields those indexes are unique on.
   *
   * By the time a run has finished, whatever stood under those names has been
   * renamed aside and what is there now is the new model's alone - on a fresh
   * install because there was never anything else. So the builds happen here,
   * on every boot rather than only after a migration applied something: they
   * are idempotent, and a boot that applies nothing is the ordinary one.
   *
   * A failure is logged rather than thrown, as every index build in this server
   * is: a missing index is slow, and refusing to start is worse.
   */
  private async buildSeparatedIndexes(): Promise<void> {
    for (const name of V1_MODELS_MIGRATED_IN_PLACE) {
      const model = this.connection.models[name];
      if (!model) continue;

      try {
        await model.createIndexes();
      } catch (error) {
        logger.error(`Migrations: building the indexes of ${model.collection.collectionName} failed: ${error}`);
      }
    }
  }

  private async apply(step: MigrationStep, dryRun: boolean, allowRejects: boolean): Promise<MigrationOutcome> {
    const startedAt = Date.now();
    const context = new MigrationContext(this.db, dryRun, new Date());

    try {
      await step.run(context);
      await context.flushAll();
    } catch (error) {
      throw new Error(`Migration ${step.name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`, { cause: error });
    }

    const outcome: MigrationOutcome = {
      name: step.name,
      durationMs: Date.now() - startedAt,
      stats: context.stats,
      rejects: context.rejects,
      rejectCount: context.rejectCount,
    };

    // A step that could not take a row is not recorded as applied unless the run
    // is allowed to leave those rows behind - otherwise the next run would skip
    // it, and a refusal that lasts one run is no refusal at all.
    if (!dryRun && (allowRejects || outcome.rejectCount === 0)) {
      const appliedAt = new Date();
      await this.db.collection(MIGRATIONS).updateOne(
        { name: step.name },
        {
          $set: { appliedAt, durationMs: outcome.durationMs, stats: outcome.stats, rejects: outcome.rejects, rejectCount: outcome.rejectCount },
          $setOnInsert: { id: derivedId('migration', step.name), createdAt: appliedAt, name: step.name },
        },
        { upsert: true },
      );
    }

    return outcome;
  }

  private async appliedNames(): Promise<Set<string>> {
    const records = await this.db
      .collection(MIGRATIONS)
      .find({}, { projection: { name: 1 } })
      .toArray();
    return new Set(records.map(record => String(record.name)));
  }
}

const describe = (outcome: MigrationOutcome): string => {
  const counts = Object.entries(outcome.stats)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key}=${value}`);
  return counts.length > 0 ? counts.join(', ') : 'nothing to do';
};
