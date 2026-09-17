import { Schema } from 'mongoose';
import { Scheme, SchemeAmount, SchemeOrigin, SchemeWeek } from '@fg2/shared-types/v1';
import { growthStage } from '@fg2/shared-types/v1-schemas';

/**
 * A person's own feeding scheme. The grid is the same table a grow carries, so
 * that editing a scheme here and reading it back off a grow speak one language;
 * a grow keeps its own copy of the grid, which is what leaves its history alone
 * when this one is edited later.
 *
 * Shipped schemes are JSON assets in the client and this server never reads one.
 * `origin` is what a client that started from an asset says about it.
 */
export type SchemeDocument = Omit<Scheme, 'createdAt'> & { createdAt: Date };

const amountSchema = new Schema<SchemeAmount>(
  {
    productKey: { type: String, required: true },
    name: { type: String, required: true },
    // Null is "not this week", which is a row of the grid and not a missing value.
    value: { type: Number, default: null },
    unit: { type: String, required: true },
  },
  { _id: false },
);

const weekSchema = new Schema<SchemeWeek>(
  {
    week: { type: Number, required: true },
    stage: { type: String, enum: growthStage.options, default: null },
    amounts: { type: [amountSchema], required: true, default: [] },
  },
  { _id: false },
);

const originSchema = new Schema<SchemeOrigin>(
  {
    assetId: { type: String, default: null },
    version: { type: String, default: null },
  },
  { _id: false },
);

export const schemesSchema = new Schema<SchemeDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    ownerId: { type: String, required: true },
    name: { type: String, required: true },
    origin: { type: originSchema, required: true, default: () => ({ assetId: null, version: null }) },
    grid: { type: [weekSchema], required: true, default: [] },
  },
  { collection: 'schemes', versionKey: false },
);

// The only read there is: a person's own schemes, newest first.
schemesSchema.index({ ownerId: 1, createdAt: -1 });
