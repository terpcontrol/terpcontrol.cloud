import { mongo } from 'mongoose';
import { logger } from '@utils/logger';

/**
 * What a migration is handed and what it records.
 *
 * Reads and writes go through the driver rather than through a mongoose model,
 * for two reasons. The old shapes have no model any more once a collection is
 * renamed aside, and a model would cast what it reads to a schema that does not
 * describe it. And a transform has to produce a *complete* document - the model
 * says "none is null, never absent", and a default filled in by mongoose would
 * hide a field the transform forgot to decide.
 */

/** A document a transform could not take, or a part of one. It never stops the run. */
export interface MigrationReject {
  /** The collection the document was read from. */
  source: string;
  /** Whatever names it there: its id, or its `_id` when it has no other. */
  id: string;
  reason: string;
  /** False when the document was still written and only the part named in `reason` was left out. */
  dropped: boolean;
  /** The value that could not be taken, where keeping it is what makes the reject actionable. */
  detail: string | null;
}

export interface MigrationStep {
  /** Unique, ordered by it, and what the `migrations` record says has already run. */
  readonly name: string;
  /**
   * The old collections this step reads, and therefore the ones moved aside
   * before it runs.
   *
   * Declared rather than moved inside `run`, because something outside the step
   * has to know it: a record claiming a step has run is a lie when the
   * collection that step moves is still standing under its own name. That is a
   * question about a step that did *not* finish, so it cannot be answered by
   * asking the step to say so while it works.
   */
  readonly moves?: readonly string[];
  run(context: MigrationContext): Promise<void>;
}

/** The prefix an old collection is moved under, and what a restore of the old shapes finds beside it. */
export const LEGACY_PREFIX = 'legacy_';

export const legacyName = (collection: string): string => `${LEGACY_PREFIX}${collection}`;

/** Upserts per round trip. Big enough to keep the trips down, small enough not to hold a batch of firmware images. */
const WRITE_BATCH = 500;

/**
 * Rejects kept in the migration record itself. The whole list goes to the log,
 * and a database where a hundred thousand documents are wrong is one to read the
 * log of rather than one to store a hundred thousand reasons in - a BSON
 * document holds 16 MB, and the record has to be readable.
 */
const RECORDED_REJECTS = 200;

export class MigrationContext {
  private readonly counters = new Map<string, number>();
  private readonly recorded: MigrationReject[] = [];
  private readonly queued = new Map<string, mongo.AnyBulkWriteOperation[]>();
  private existing: Set<string> | null = null;
  private rejected = 0;

  constructor(
    /** The one migration that touches the picture bucket needs the driver's handle; every other read goes through `source`. */
    public readonly db: mongo.Db,
    /** A dry run reads and counts, and writes nothing at all - not even the rename. */
    public readonly dryRun: boolean,
    /** One clock for the whole run, so every document a migration dates carries the same instant. */
    public readonly at: Date,
    /**
     * The language this install's growers speak, which is the one thing the old
     * database cannot be asked: an old account records no language at all. It
     * names the eight measurement definitions a reconstructed grow is given and
     * seeds each account's own preference, both of which are a person's own the
     * moment they are written and are never translated again.
     */
    public readonly locale: string = 'en',
  ) {}

  /**
   * Moves an old collection out of the way, which is a metadata operation and
   * instant.
   *
   * Skipped when it has already been moved, which is what lets a run that was
   * killed after the rename repeat without ever touching the old data again.
   *
   * Skipped as well when there is nothing in it. A fresh install has no old data
   * at all, and mongoose has already created every collection its models declare
   * an index on by the time this runs - so without this, a first boot would move
   * a dozen empty collections aside, leave a `legacy_*` behind that says a
   * migration happened where none did, and take the legacy layer's own indexes
   * with them.
   */
  public async renameAside(collection: string): Promise<void> {
    if (this.dryRun) return;

    const names = await this.collectionNames();
    if (names.has(legacyName(collection)) || !names.has(collection)) return;
    if ((await this.db.collection(collection).countDocuments({}, { limit: 1 })) === 0) return;

    await this.db.renameCollection(collection, legacyName(collection));
    names.delete(collection);
    names.add(legacyName(collection));
    this.count(`${collection}.renamedAside`);
  }

  /**
   * Where an old collection is read from: under its new name once it has been
   * moved aside, under its old one before that. Both answers are right, which is
   * what makes a migration repeatable and a dry run possible on a database that
   * has never been touched.
   */
  public async source(collection: string): Promise<mongo.Collection> {
    const names = await this.collectionNames();
    return this.db.collection(names.has(legacyName(collection)) ? legacyName(collection) : collection);
  }

  public count(key: string, by = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  public reject(reject: MigrationReject): void {
    this.rejected++;
    this.count(`${reject.source}.rejected`);
    if (this.recorded.length < RECORDED_REJECTS) this.recorded.push(reject);
    logger.warn(`Migration rejected ${reject.source}/${reject.id}: ${reject.reason}${reject.detail ? ` (${reject.detail})` : ''}`);
  }

  /**
   * Copies one document. An upsert by `id` rather than an insert: a run that was
   * killed re-copies whatever it had already written, and the second write has
   * to be the first one again rather than a duplicate.
   */
  public async write(collection: string, document: Record<string, unknown> & { id: string }): Promise<void> {
    this.count(`${collection}.written`);

    const operations = this.queued.get(collection) ?? [];
    operations.push({ updateOne: { filter: { id: document.id }, update: { $set: document }, upsert: true } });
    this.queued.set(collection, operations);

    if (operations.length >= WRITE_BATCH) await this.flush(collection);
  }

  public async flushAll(): Promise<void> {
    for (const collection of [...this.queued.keys()]) await this.flush(collection);
  }

  private async flush(collection: string): Promise<void> {
    const operations = this.queued.get(collection) ?? [];
    this.queued.delete(collection);
    if (operations.length === 0) return;

    if (this.dryRun) return;

    try {
      await this.db.collection(collection).bulkWrite(operations, { ordered: false });
    } catch (error) {
      // Unordered, so the batch wrote everything it could and the failures are
      // named one by one. A document the new indexes refuse - a duplicate
      // handle, a second binary under one name - is a reject like any other and
      // must not take the rest of the collection down with it.
      const failures = error instanceof mongo.MongoBulkWriteError ? error.writeErrors : null;
      if (!failures) throw error;

      for (const failure of Array.isArray(failures) ? failures : [failures]) {
        const operation = operations[failure.index] as { updateOne?: { filter: { id: string } } } | undefined;
        this.count(`${collection}.written`, -1);
        this.reject({
          source: collection,
          id: operation?.updateOne?.filter.id ?? String(failure.index),
          reason: 'the write was refused',
          dropped: true,
          detail: failure.errmsg ?? null,
        });
      }
    }
  }

  public get stats(): Record<string, number> {
    return { ...Object.fromEntries(this.counters), rejected: this.rejected };
  }

  public get rejects(): MigrationReject[] {
    return this.recorded;
  }

  public get rejectCount(): number {
    return this.rejected;
  }

  private async collectionNames(): Promise<Set<string>> {
    if (!this.existing) {
      const listed = await this.db.listCollections({}, { nameOnly: true }).toArray();
      this.existing = new Set(listed.map(entry => entry.name));
    }
    return this.existing;
  }
}
