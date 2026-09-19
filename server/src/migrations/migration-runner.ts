import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import { V1_MODELS_MIGRATED_IN_PLACE } from '@database/models.module';
import { logger } from '@utils/logger';
import { derivedId } from './ids';
import { MigrationContext, MigrationReject, MigrationStep } from './migration';
import { MigrationLock } from './migration-lock';
import { RollbackRefused } from './migration-rollback';
import { PreflightFailure, StaleMigrationRecord, preflight, unmigratedCollections } from './preflight';
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
 * What a run is doing, as it happens.
 *
 * A run that only reports when it returns is silent for exactly as long as it
 * takes - four minutes of nothing on a database with a few hundred thousand
 * rows in it - and a run that throws says nothing at all about the steps that
 * applied before it. Neither is something an operator can read, so the report
 * the caller gets at the end is what a run *did*, and this is what it is doing.
 */
export type RunEvent =
  | { at: 'nothing-to-do'; applied: number }
  | { at: 'checking'; pending: string[]; applied: string[] }
  | { at: 'starting'; pending: string[] }
  | { at: 'step-starting'; name: string; index: number; of: number }
  | { at: 'step-finished'; outcome: MigrationOutcome; index: number; of: number }
  | { at: 'finished'; applied: MigrationOutcome[]; durationMs: number }
  | { at: 'stopped'; step: string | null };

export type RunWatcher = (event: RunEvent) => void;

/**
 * One wording for what a run is doing, so the boot log and the command cannot
 * drift apart. `Migrations:` for the run, `Migration <name>` for a step, which
 * is the prefix the lock and the index builder already use. A dry run says
 * rehearsed where a real one says applied, because it wrote none of it.
 */
export const runProgress = (event: RunEvent, dryRun = false): { level: 'info' | 'warn' | 'error'; line: string } => {
  const took = dryRun ? 'rehearsed' : 'applied';

  switch (event.at) {
    case 'nothing-to-do':
      // The line that tells "already migrated" from "never looked", which
      // nothing said before: both were silence.
      return { level: 'info', line: `Migrations: nothing to do; all ${event.applied} of them have already been applied` };
    case 'checking':
      return {
        level: 'info',
        line:
          `Migrations: ${event.pending.length} of ${MIGRATION_STEPS.length} to apply` +
          `${event.applied.length > 0 ? ` (${event.applied.length} already applied)` : ''}; checking the database first`,
      };
    case 'starting':
      return event.pending.length === 0
        ? { level: 'info', line: 'Migrations: nothing left to apply; another instance had just finished' }
        : { level: 'info', line: `Migrations: ${dryRun ? 'rehearsing' : 'applying'} ${event.pending.join(', ')}` };
    case 'step-starting':
      return { level: 'info', line: `Migration ${event.name} starting (${event.index} of ${event.of})` };
    case 'step-finished':
      return {
        level: event.outcome.rejectCount > 0 ? 'warn' : 'info',
        line:
          `Migration ${event.outcome.name} ${took} in ${event.outcome.durationMs} ms` +
          `${event.outcome.rejectCount > 0 ? `, ${plural(event.outcome.rejectCount, 'row')} refused` : ''}: ${describe(event.outcome)}`,
      };
    case 'finished': {
      const refused = event.applied.reduce((total, outcome) => total + outcome.rejectCount, 0);
      return {
        level: 'info',
        line:
          `Migrations: finished; ${plural(event.applied.length, 'migration')} ${took} in ${event.durationMs} ms` +
          `${refused > 0 ? `, ${plural(refused, 'row')} refused` : ''}`,
      };
    }
    case 'stopped':
      return { level: 'error', line: `Migrations: stopped${event.step ? ` at ${event.step}` : ''}; nothing after that was written` };
  }
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A refusal is a report to read, not a crash: it prints as it was written, with no stack in front of it. */
export const migrationFailureText = (error: unknown): string => {
  if (error instanceof PreflightFailure || error instanceof RejectedRows || error instanceof StaleMigrationRecord || error instanceof RollbackRefused)
    return error.message;
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
};

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
    try {
      // Nobody types a flag when a container starts, so the deliberate way past
      // a rejected row is set where the rest of the deployment is.
      await this.run({
        dryRun: false,
        allowRejects: process.env.MIGRATION_ALLOW_REJECTS === 'true',
        watch: event => {
          const { level, line } = runProgress(event);
          logger[level](line);
        },
      });
    } catch (error) {
      // Written here rather than left to the fatal handler, which would put a
      // stack between the reason and the reader and print the whole of it twice.
      logger.error(migrationFailureText(error));
      throw new Error('Migrations: the database was not migrated; the reason is above');
    }

    await this.buildSeparatedIndexes();
  }

  /**
   * The record is not believed on its own, where it claims a step has run.
   *
   * A dump taken before the upgrade and restored into a database this release
   * has already started against comes out looking migrated: a restore drops
   * only the collections the archive carries, so the `migrations` record of the
   * database it landed in survives. Nothing is then pending, nothing is renamed
   * aside, and the server serves accounts in a shape nobody can sign in to.
   *
   * A record of a run that stopped part way survives a restore exactly as a
   * complete one does, and is the more dangerous of the two: a handful of steps
   * count as applied, the rest run over freshly restored old data, and the boot
   * *succeeds* half-migrated. So the question is asked of each recorded step
   * rather than only of a full record - a step that ran has moved the
   * collections it reads aside, and finding one of them still standing under its
   * own name with old rows in it says the record is describing a database that
   * is no longer there. The collections no recorded step has reached yet are
   * exactly where a resumable run leaves them, and are not asked about.
   *
   * A `listCollections` and at most twelve counts, on a boot that would
   * otherwise do nothing at all.
   */
  public async refuseAStaleRecord(): Promise<void> {
    const applied = await this.appliedNames();
    if (applied.size === 0) return;

    const moved = new Set(MIGRATION_STEPS.filter(step => applied.has(step.name)).flatMap(step => [...(step.moves ?? [])]));
    const stale = (await unmigratedCollections(this.db)).filter(name => moved.has(name));
    if (stale.length > 0) throw new StaleMigrationRecord(stale, applied.size, MIGRATION_STEPS.length);
  }

  /** How far this database has been taken, for a report that has to say where a run stopped. */
  public async progress(): Promise<{ applied: string[]; pending: string[] }> {
    const applied = await this.appliedNames();
    return {
      applied: MIGRATION_STEPS.filter(step => applied.has(step.name)).map(step => step.name),
      pending: MIGRATION_STEPS.filter(step => !applied.has(step.name)).map(step => step.name),
    };
  }

  public async run({
    dryRun,
    allowRejects = false,
    watch,
  }: {
    dryRun: boolean;
    allowRejects?: boolean;
    watch?: RunWatcher;
  }): Promise<MigrationRunReport> {
    const startedAt = Date.now();
    const applied = await this.appliedNames();
    const report: MigrationRunReport = { dryRun, applied: [], alreadyApplied: MIGRATION_STEPS.filter(s => applied.has(s.name)).map(s => s.name) };

    // The record against the database, before the pending list is acted on and
    // whether or not anything is pending: a record that describes a database
    // this one is not is the one thing no step can recover from.
    await this.refuseAStaleRecord();

    if (report.alreadyApplied.length === MIGRATION_STEPS.length) {
      watch?.({ at: 'nothing-to-do', applied: report.alreadyApplied.length });
      return report;
    }

    watch?.({ at: 'checking', pending: MIGRATION_STEPS.filter(s => !applied.has(s.name)).map(s => s.name), applied: report.alreadyApplied });

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
    let reached: string | null = null;
    try {
      const alreadyApplied = dryRun ? applied : await this.appliedNames();
      report.alreadyApplied = MIGRATION_STEPS.filter(step => alreadyApplied.has(step.name)).map(step => step.name);

      const pending = MIGRATION_STEPS.filter(step => !alreadyApplied.has(step.name));
      watch?.({ at: 'starting', pending: pending.map(step => step.name) });

      for (const [index, step] of pending.entries()) {
        reached = step.name;
        watch?.({ at: 'step-starting', name: step.name, index: index + 1, of: pending.length });

        const outcome = await this.apply(step, dryRun, allowRejects);
        report.applied.push(outcome);
        watch?.({ at: 'step-finished', outcome, index: index + 1, of: pending.length });

        // A row a transform could not take is a row that will not be in the new
        // model, and a report nobody has to read is not a safeguard: an entry
        // rule that dropped every diary line anybody had ever written reported
        // each one and finished green. So the run stops here with what this step
        // rejected, and whoever reads it decides - fix the rows and run again,
        // or say with `allowRejects` that leaving them behind is the intention.
        // What was written stays: every copy is an upsert keyed by the document
        // it came from, so the next run carries on rather than starting over.
        //
        // A rehearsal is the exception, and has to be: it is read to find out
        // what the real run will refuse, and a dry run that stopped at the first
        // step with a reject in it never rehearsed the transforms after that one
        // - so the report an operator reads before setting `--allow-rejects`
        // would name the rows of one step and stay silent about every step it
        // never reached.
        if (!dryRun && !allowRejects && outcome.rejectCount > 0) throw new RejectedRows(outcome);
      }

      reached = null;
    } catch (error) {
      // Said before the reason is, so that a log which ends in a crash still
      // names how far the run got - which the report, discarded with the throw,
      // no longer can.
      watch?.({ at: 'stopped', step: reached });
      throw error;
    } finally {
      await lock?.release();
    }

    watch?.({ at: 'finished', applied: report.applied, durationMs: Date.now() - startedAt });
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
      // The step's own sources, moved out of the way before it reads them. Here
      // rather than in the step, so that what a step has moved is something the
      // rollback and the stale-record check can read off it without running it.
      for (const collection of step.moves ?? []) await context.renameAside(collection);
      await step.run(context);
      await context.flushAll();
    } catch (error) {
      throw new Error(`Migration ${step.name} failed: ${reasonOf(error)}`, { cause: error });
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
      try {
        await this.db.collection(MIGRATIONS).updateOne(
          { name: step.name },
          {
            $set: { appliedAt, durationMs: outcome.durationMs, stats: outcome.stats, rejects: outcome.rejects, rejectCount: outcome.rejectCount },
            $setOnInsert: { id: derivedId('migration', step.name), createdAt: appliedAt, name: step.name },
          },
          { upsert: true },
        );
      } catch (error) {
        // Named like every other failure inside a step: without this the record
        // being unwritable surfaces as a bare driver error with nothing in it
        // saying which migration the run was on.
        throw new Error(`Migration ${step.name} ran but could not be recorded as applied: ${reasonOf(error)}`, { cause: error });
      }
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

const reasonOf = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error));

const describe = (outcome: MigrationOutcome): string => {
  const counts = Object.entries(outcome.stats)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key}=${value}`);
  return counts.length > 0 ? counts.join(', ') : 'nothing to do';
};
