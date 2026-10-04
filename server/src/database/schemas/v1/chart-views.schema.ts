import { Schema } from 'mongoose';
import { ChartView, ChartViewDefinition, ChartViewSpan, TimeRange } from '@fg2/shared-types/v1';
import { chartViewLayout, chartViewSpan, metric, outputMetric } from '@fg2/shared-types/v1-schemas';

/**
 * A saved chart, structured rather than the query string the old app stored, so
 * that what a view draws can be read and validated instead of parsed.
 *
 * Nothing here is resolved on the way in. A span of "this phase" and a series
 * named after one of the grow's measurements are both answered from the grow as
 * it stands when the chart is drawn, which is what makes a view saved in week
 * three still worth opening in week nine.
 */
type TimeRangeDocument = Omit<TimeRange, 'startsAt' | 'endsAt'> & { startsAt: Date | null; endsAt: Date | null };

/**
 * The span as one subdocument, with the field of every arm and only those of its
 * own kind filled, the way an alarm rule stores its watch. Mongoose has no union
 * of subdocuments; the contract is where a span that is both a fixed range and a
 * rolling one cannot be written down, and `ChartViewDefinitionDocument.span` is
 * the union all the same, so nothing reads a field the kind does not have.
 */
interface StoredChartViewSpan {
  kind: ChartViewSpan['kind'];
  forSeconds: number | null;
  range: TimeRangeDocument | null;
}

type ChartViewDefinitionDocument = Omit<ChartViewDefinition, 'span'> & { span: StoredChartViewSpan };

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

const spanKinds = chartViewSpan.options.map(option => option.shape.kind.value);

const spanSchema = new Schema<StoredChartViewSpan>(
  {
    kind: { type: String, enum: spanKinds, required: true },
    forSeconds: { type: Number, default: null },
    range: { type: rangeSchema, default: null },
  },
  { _id: false, versionKey: false },
);

const definitionSchema = new Schema<ChartViewDefinitionDocument>(
  {
    deviceIds: { type: [String], required: true, default: [] },
    growId: { type: String, default: null },
    metrics: { type: [{ type: String, enum: metric.options }], required: true, default: [] },
    outputs: { type: [{ type: String, enum: outputMetric.options }], required: true, default: [] },
    // Free text rather than an enum: these are the keys of one grow's own
    // measurement definitions, which are whatever that grower called them.
    measurements: { type: [String], required: true, default: [] },
    span: { type: spanSchema, required: true },
    layout: { type: String, enum: chartViewLayout.options, required: true, default: 'stacked' },
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
