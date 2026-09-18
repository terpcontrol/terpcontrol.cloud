import { Schema } from 'mongoose';
import { ChartView, ChartViewDefinition, TimeRange } from '@fg2/shared-types/v1';
import { metric, outputMetric } from '@fg2/shared-types/v1-schemas';

/**
 * A saved chart, structured rather than the query string the old app stored, so
 * that what a view draws can be read and validated instead of parsed.
 *
 * A view is either a fixed `range` or the last `forSeconds`, never both, which is
 * why each is nullable on its own.
 */
type TimeRangeDocument = Omit<TimeRange, 'startsAt' | 'endsAt'> & { startsAt: Date | null; endsAt: Date | null };

type ChartViewDefinitionDocument = Omit<ChartViewDefinition, 'range'> & { range: TimeRangeDocument | null };

export type ChartViewDocument = Omit<ChartView, 'createdAt' | 'definition'> & {
  createdAt: Date;
  definition: ChartViewDefinitionDocument;
};

/** Either end may be open, which is what `null` says. */
const rangeSchema = new Schema<TimeRangeDocument>(
  {
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { _id: false },
);

const definitionSchema = new Schema<ChartViewDefinitionDocument>(
  {
    deviceIds: { type: [String], required: true, default: [] },
    growId: { type: String, default: null },
    metrics: { type: [{ type: String, enum: metric.options }], required: true, default: [] },
    outputs: { type: [{ type: String, enum: outputMetric.options }], required: true, default: [] },
    range: { type: rangeSchema, default: null },
    forSeconds: { type: Number, default: null },
    intervalSeconds: { type: Number, required: true },
  },
  { _id: false },
);

export const chartViewsSchema = new Schema<ChartViewDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    ownerId: { type: String, required: true },
    name: { type: String, required: true },
    definition: { type: definitionSchema, required: true },
  },
  { collection: 'chartViews', versionKey: false },
);

// The only read there is: a person's own saved views, newest first.
chartViewsSchema.index({ ownerId: 1, createdAt: -1 });
