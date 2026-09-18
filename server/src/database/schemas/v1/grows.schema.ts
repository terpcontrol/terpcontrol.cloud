import { Schema } from 'mongoose';
import { growthStage, growType, growVisibility, phaseSource } from '@fg2/shared-types/v1-schemas';
import type {
  ClimateTargets,
  Grow,
  GrowScheme,
  MeasurementDefinition,
  Phase,
  PhaseTargets,
  Placement,
  SchemeAmount,
  SchemeWeek,
} from '@fg2/shared-types/v1';

type PhaseDocument = Omit<Phase, 'startedAt'> & { startedAt: Date };
type PlacementDocument = Omit<Placement, 'startedAt' | 'endedAt'> & { startedAt: Date; endedAt: Date | null };

/**
 * The whole story of a set of plants. `phases[]` and `placements[]` are embedded
 * because they are only ever read with the grow they belong to and are written
 * by appending; a plant is a document of its own, because a phase, a placement
 * and a harvest each name exactly which plants they are about.
 */
export type GrowDocument = Omit<Grow, 'phases' | 'placements' | 'startedAt' | 'endedAt' | 'createdAt' | 'updatedAt'> & {
  phases: PhaseDocument[];
  placements: PlacementDocument[];
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// `_id: false` throughout: every embedded row carries the contract's own `id`,
// and mongoose's second identifier would be bookkeeping stored as data.
const embedded = { _id: false } as const;

const climateTargetsSchema = new Schema<ClimateTargets>(
  {
    temperature: { type: Number, default: null },
    humidity: { type: Number, default: null },
  },
  embedded,
);

const phaseTargetsSchema = new Schema<PhaseTargets>(
  {
    day: { type: climateTargetsSchema, required: true },
    night: { type: climateTargetsSchema, required: true },
    co2: { type: Number, default: null },
  },
  embedded,
);

const phaseSchema = new Schema<PhaseDocument>(
  {
    id: { type: String, required: true },
    stage: { type: String, enum: growthStage.options, required: true },
    preset: { type: String, default: null },
    startedAt: { type: Date, required: true },
    source: { type: String, enum: phaseSource.options, required: true },
    plantIds: { type: [String], default: null },
    deviceId: { type: String, default: null },
    targets: { type: phaseTargetsSchema, default: null },
    setBy: { type: String, default: null },
  },
  embedded,
);

const placementSchema = new Schema<PlacementDocument>(
  {
    id: { type: String, required: true },
    spaceId: { type: String, default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    plantIds: { type: [String], default: null },
  },
  embedded,
);

const schemeAmountSchema = new Schema<SchemeAmount>(
  {
    productKey: { type: String, required: true },
    name: { type: String, required: true },
    value: { type: Number, default: null },
    unit: { type: String, required: true },
  },
  embedded,
);

const schemeWeekSchema = new Schema<SchemeWeek>(
  {
    week: { type: Number, required: true },
    stage: { type: String, enum: growthStage.options, default: null },
    amounts: { type: [schemeAmountSchema], required: true, default: [] },
  },
  embedded,
);

const growSchemeSchema = new Schema<GrowScheme>(
  {
    // A discriminated union on `type` - an asset of the client with its version,
    // or one of the user's own schemes - which mongoose cannot state; the v1
    // schema validates it at the boundary and it is stored as it is written.
    origin: { type: Schema.Types.Mixed, required: true },
    strength: { type: Number, required: true, default: 1 },
    waterEc: { type: Number, default: null },
    plantType: { type: String, required: true },
    flipWeek: { type: Number, default: null },
    edited: { type: Boolean, required: true, default: false },
    grid: { type: [schemeWeekSchema], required: true, default: [] },
  },
  embedded,
);

const measurementSchema = new Schema<MeasurementDefinition>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    // Always there and sometimes empty: pH is a number with no unit at all, and
    // `required` on a string refuses exactly that, where the contract allows it.
    unit: { type: String, default: '' },
    perPlant: { type: Boolean, required: true, default: false },
    target: { type: Number, default: null },
    chart: { type: Boolean, required: true, default: false },
  },
  embedded,
);

export const growsSchema = new Schema<GrowDocument>(
  {
    id: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    type: { type: String, enum: growType.options, required: true },
    phases: { type: [phaseSchema], required: true, default: [] },
    placements: { type: [placementSchema], required: true, default: [] },
    scheme: { type: growSchemeSchema, default: null },
    measurements: { type: [measurementSchema], required: true, default: [] },
    visibility: { type: String, enum: growVisibility.options, required: true, default: 'private' },
    slug: { type: String, required: true },
    coverMediaId: { type: String, default: null },
    filmMediaId: { type: String, default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    isDemo: { type: Boolean, required: true, default: false },
  },
  { collection: 'grows', timestamps: true, versionKey: false },
);

// The grow list, newest first.
growsSchema.index({ ownerId: 1, startedAt: -1 });

// The public page and the HTML shell address a grow by its slug. Partial, so
// that a grow reconstructed by the migration without one is not a duplicate of
// every other grow without one.
growsSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });

// Which grow stands in a space: the home and space screens, and `access()`,
// which reads a grow's spaces from its placements.
growsSchema.index({ 'placements.spaceId': 1 });

// The demo session reads every demo object, across owners.
growsSchema.index({ isDemo: 1 });
