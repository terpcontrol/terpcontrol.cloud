import { Schema } from 'mongoose';
import { Migration } from '@fg2/shared-types/v1';

/**
 * What has run. A migration is applied once and in order, and the record is both
 * what says it has already run and what an operator reads afterwards - so `stats`
 * keeps whatever that migration counted, rows moved and rows rejected, and is not
 * typed: every migration counts something else.
 */
export type MigrationDocument = Omit<Migration, 'createdAt' | 'appliedAt'> & {
  createdAt: Date;
  appliedAt: Date;
  rejects: MigrationRejectDocument[];
  rejectCount: number;
};

/**
 * A document the migration could not take, or the part of one it could not.
 * Stored and never served: the contract answers a migration's counts, and the
 * reasons are for whoever reads the report with the backup in hand.
 *
 * Capped on the way in, because a record has to stay readable and a BSON
 * document holds 16 MB; `rejectCount` says how many there really were and the
 * log carries every one of them.
 */
export interface MigrationRejectDocument {
  /** The collection the document was read from. */
  source: string;
  id: string;
  reason: string;
  /** False when the document was written anyway and only the part named in `reason` was left out. */
  dropped: boolean;
  detail: string | null;
}

const rejectSchema = new Schema<MigrationRejectDocument>(
  {
    source: { type: String, required: true },
    id: { type: String, required: true },
    reason: { type: String, required: true },
    dropped: { type: Boolean, required: true },
    detail: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

export const migrationsSchema = new Schema<MigrationDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    // Unique, and taken before the transforms run: it is what keeps two
    // instances from both migrating and a restarted run from starting over.
    name: { type: String, required: true, unique: true },
    appliedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    stats: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    rejects: { type: [rejectSchema], required: true, default: [] },
    rejectCount: { type: Number, required: true, default: 0 },
  },
  // A migration that counted nothing still has `stats`, which mongoose would
  // otherwise drop on its way out for being an empty object.
  { collection: 'migrations', versionKey: false, minimize: false },
);
