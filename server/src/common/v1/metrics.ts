import { Metric, OutputMetric } from '@fg2/shared-types/v1';
import { metric, outputMetric } from '@fg2/shared-types/v1-schemas';

/**
 * The one translation between what the API calls a series and what a device
 * writes it as, which the Influx layer and the device protocol both ask for and
 * neither keeps a map of its own.
 *
 * The device's InfluxDB field names are frozen - they are written by firmware in
 * the field and by three years of stored points - so the translation lives here
 * and nowhere else. The device writes sensors under their bare name and outputs
 * with an `out_` prefix, three of them hyphenated.
 *
 * The remaining fields a device writes (`avg`, `p`, `i`, `d`, `rpm`, `day`,
 * `sensor_type`) are controller diagnostics that no screen asks for, so the API
 * names no metric for them; they keep being written and stay readable in Influx.
 */
const METRIC_FIELD: Readonly<Record<Metric, string | null>> = {
  temperature: 'temperature',
  humidity: 'humidity',
  co2: 'co2',
  leafTemperature: 'leaf_temperature',
  lux: 'lux',
  vpd: null,
  ppfd: null,
  offline: null,
};

const OUTPUT_METRIC_FIELD: Readonly<Record<OutputMetric, string>> = {
  heater: 'out_heater',
  dehumidifier: 'out_dehumidifier',
  co2: 'out_co2',
  light: 'out_light',
  fan: 'out_fan',
  relais: 'out_relais',
  fanInternal: 'out_fan-internal',
  fanExternal: 'out_fan-external',
  fanBackwall: 'out_fan-backwall',
};

const byField = <M extends string>(fields: Readonly<Record<M, string | null>>): Readonly<Record<string, M>> => {
  const map: Record<string, M> = {};
  for (const [name, field] of Object.entries(fields) as [M, string | null][]) {
    if (field !== null) map[field] = name;
  }
  return map;
};

/** The other direction, for reading a point back out of Influx. Derived, so the two cannot drift. */
const FIELD_METRIC = byField(METRIC_FIELD);
const FIELD_OUTPUT_METRIC = byField(OUTPUT_METRIC_FIELD);

/** The Influx field a device writes this metric under; null for one the server computes. */
export const fieldOfMetric = (name: Metric): string | null => METRIC_FIELD[name];

export const fieldOfOutputMetric = (name: OutputMetric): string => OUTPUT_METRIC_FIELD[name];

/** Reading a point back: the metric a stored field is, or null for a field the API names nothing for. */
export const metricOfField = (field: string): Metric | null => FIELD_METRIC[field] ?? null;

export const outputMetricOfField = (field: string): OutputMetric | null => FIELD_OUTPUT_METRIC[field] ?? null;

/** The metrics with points behind them: what a query may ask Influx for. */
export const STORED_METRICS: readonly Metric[] = metric.options.filter(name => METRIC_FIELD[name] !== null);

/** Every field a series query selects, by the name it has in Influx. */
export const STORED_FIELDS: readonly string[] = STORED_METRICS.map(name => METRIC_FIELD[name] as string);

export const OUTPUT_FIELDS: readonly string[] = outputMetric.options.map(name => OUTPUT_METRIC_FIELD[name]);

/**
 * The outputs a device drives at a level rather than only on and off, and what
 * the figure it writes has to be multiplied by to be the share of full output.
 * The firmware writes the lamp and an AIR's fan in percent, and the heater's
 * demand and a fridge's three fans as a fraction of one. The CO2 valve is a
 * count of open ticks rather than a share of anything, and is summed instead.
 * A dehumidifier and a socket's relay are switches: their lanes say when, and
 * that is all there is to say.
 */
export const OUTPUT_LEVEL: Readonly<Partial<Record<OutputMetric, { unit: 'percent' | 'count'; scale: number }>>> = {
  light: { unit: 'percent', scale: 1 },
  fan: { unit: 'percent', scale: 1 },
  heater: { unit: 'percent', scale: 100 },
  fanInternal: { unit: 'percent', scale: 100 },
  fanExternal: { unit: 'percent', scale: 100 },
  fanBackwall: { unit: 'percent', scale: 100 },
  co2: { unit: 'count', scale: 1 },
};
