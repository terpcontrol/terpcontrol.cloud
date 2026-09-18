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
    const report = await this.run({ dryRun: false });
    for (const outcome of report.applied) {
      logger.info(`Migration ${outcome.name} applied in ${outcome.durationMs} ms: ${describe(outcome)}`);
    }

    await this.buildSeparatedIndexes();
  }

  public async run({ dryRun }: { dryRun: boolean }): Promise<MigrationRunReport> {
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
        report.applied.push(await this.apply(step, dryRun));
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

  private async apply(step: MigrationStep, dryRun: boolean): Promise<MigrationOutcome> {
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

    if (!dryRun) {
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
