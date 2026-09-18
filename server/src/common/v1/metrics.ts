import { Metric, OutputMetric } from '@fg2/shared-types/v1';
import { FIELD_METRIC, FIELD_OUTPUT_METRIC, METRIC_FIELD, OUTPUT_METRIC_FIELD, metric, outputMetric } from '@fg2/shared-types/v1-schemas';

/**
 * The one translation between what the API calls a series and what a device
 * writes it as. The tables are the contract's - the device's field names are
 * frozen by firmware in the field and by years of stored points - so this file
 * only turns them into the lookups the Influx layer and the device protocol
 * both ask for, and neither keeps a map of its own.
 */

/** The Influx field a device writes this metric under; null for one the server computes. */
export const fieldOfMetric = (name: Metric): string | null => METRIC_FIELD[name];

export const fieldOfOutputMetric = (name: OutputMetric): string => OUTPUT_METRIC_FIELD[name];

/** Reading a point back: the metric a stored field is, or null for a field the API names nothing for. */
export const metricOfField = (field: string): Metric | null => FIELD_METRIC[field] ?? null;

export const outputMetricOfField = (field: string): OutputMetric | null => FIELD_OUTPUT_METRIC[field] ?? null;

/** The metrics with points behind them: what a query may ask Influx for. */
export const STORED_METRICS: readonly Metric[] = metric.options.filter(name => METRIC_FIELD[name] !== null);

/**
 * The rest, which no query can ask for: `vpd` and `ppfd` are computed per device
 * from stored metrics and the device's own factors, `offline` from its
 * `state.lastSeenAt`.
 */
export const DERIVED_METRICS: readonly Metric[] = metric.options.filter(name => METRIC_FIELD[name] === null);

/** Every field a series query selects, by the name it has in Influx. */
export const STORED_FIELDS: readonly string[] = STORED_METRICS.map(name => METRIC_FIELD[name] as string);

export const OUTPUT_FIELDS: readonly string[] = outputMetric.options.map(name => OUTPUT_METRIC_FIELD[name]);
