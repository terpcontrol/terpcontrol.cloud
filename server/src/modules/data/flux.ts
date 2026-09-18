import { Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { calculateVpd } from '@utils/calculateVpd';
import { fieldOfMetric, fieldOfOutputMetric } from '@common/v1/metrics';

/**
 * What is sent to InfluxDB and what comes back, kept apart from the service so
 * both can be read - and tested - without a database.
 *
 * Nothing in here is written in the API's vocabulary. A metric becomes a field
 * through the shared translation before it reaches this file, because the field
 * names are the device's: they are frozen by firmware in the field and by years
 * of stored points.
 */

/** The measurement a device's status has always been written into. */
const MEASUREMENT = 'status';

/**
 * The lux a light meter reports becomes PPFD through a factor that depends on
 * the spectrum, so it is a per-device calibration rather than physics. The
 * default assumes a white full-spectrum LED.
 */
export const DEFAULT_PPFD_LUX_FACTOR = 0.015;

/**
 * Flux is built by interpolation, so what may be interpolated is spelled out
 * here. Without this a value that closes the query could append a pipeline of
 * its own - `-1h) |> yield() from(bucket: "…"` reads the whole bucket, which
 * holds every device of every customer. Instants and durations are formatted
 * from `Date` and `number` and so can carry nothing else.
 */
const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Points per series a read is allowed to build, which decides how far a step is widened. */
const MAX_WINDOWS = 1000;

/** The narrowest step the server ever picks for itself. */
const MIN_STEP_SECONDS = 5;

/** No range answers more points than this per series, whatever the caller asked for. */
const MAX_POINTS = 50000;

/**
 * How far back a live read looks. A value older than this changes nothing - it
 * reads as `offline` either way - while an unbounded range would scan the whole
 * retention period of every field the device has ever written.
 */
const LIVE_LOOKBACK = '-30d';

const safe = (value: string, pattern: RegExp, what: string): string => {
  if (!pattern.test(value)) throw new Error(`Refusing to build a query with an impossible ${what}`);
  return value;
};

/** The field of a metric that is stored. The tables say which are, so this throws only on a programming error. */
const storedField = (name: Metric): string => {
  const field = fieldOfMetric(name);
  if (field === null) throw new Error(`${name} is computed and has no field of its own`);
  return field;
};

const head = (bucket: string, deviceId: string, range: string): string => `
  from(bucket: "${safe(bucket, SAFE_NAME, 'bucket')}")
    |> range(${range})
    |> filter(fn: (r) => r["_measurement"] == "${MEASUREMENT}")
    |> filter(fn: (r) => r["device_id"] == "${safe(deviceId, SAFE_NAME, 'device id')}")`;

const rangeOf = (window: FluxWindow): string => `start: ${window.startsAt.toISOString()}, stop: ${window.endsAt.toISOString()}`;

const aggregate = (window: FluxWindow): string => `
    |> aggregateWindow(every: ${Math.max(1, Math.trunc(window.stepSeconds))}s, fn: mean, createEmpty: true)
    |> limit(n: ${MAX_POINTS})`;

/**
 * The newest point of every field a device has written, in one query, which is
 * what a card and `/live` are built from: a device costs one read however many
 * values it reports.
 */
export const liveQuery = (bucket: string, deviceId: string): string => `${head(bucket, deviceId, `start: ${LIVE_LOOKBACK}`)}
    |> last()`;

/**
 * The step of a series. A caller that names none gets one that keeps the answer
 * readable, and one that names a step too narrow for its range has it widened
 * rather than its series cut off at the query's own limit.
 */
export const stepFor = (startsAt: Date, endsAt: Date, asked?: number): number => {
  const seconds = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 1000));
  const widest = Math.max(MIN_STEP_SECONDS, Math.ceil(seconds / MAX_WINDOWS));

  return asked && asked > 0 ? Math.max(Math.trunc(asked), widest) : widest;
};

export interface FluxWindow {
  startsAt: Date;
  endsAt: Date;
  stepSeconds: number;
}

/** One aggregated point per window per field, empty windows included so a chart draws the gap rather than joining across it. */
export const seriesQuery = (bucket: string, deviceId: string, fields: readonly string[], window: FluxWindow): string => {
  const filter = fields.map(field => `r["_field"] == "${safe(field, FIELD_NAME, 'field name')}"`).join(' or ');

  return `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${filter})${aggregate(window)}`;
};

/**
 * The same aggregate of one field over several devices, one series per device.
 * A home draws a sparkline on every card, and with this it costs one read
 * however many cards there are.
 */
export const trendQuery = (bucket: string, deviceIds: readonly string[], field: string, window: FluxWindow): string => {
  const ids = deviceIds.map(id => `"${safe(id, SAFE_NAME, 'device id')}"`).join(', ');

  return `
  from(bucket: "${safe(bucket, SAFE_NAME, 'bucket')}")
    |> range(${rangeOf(window)})
    |> filter(fn: (r) => r["_measurement"] == "${MEASUREMENT}")
    |> filter(fn: (r) => contains(value: r["device_id"], set: [${ids}]))
    |> filter(fn: (r) => r["_field"] == "${safe(field, FIELD_NAME, 'field name')}")${aggregate(window)}`;
};

/** A row as the client hands it back. `_value` is empty for a window that holds no reading. */
export interface FluxRow {
  _time?: string;
  _value?: number | null;
  _field?: string;
  device_id?: string;
}

const numberOf = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The newest reading of each field, by field name. */
export const latestByField = (rows: FluxRow[]): Map<string, { value: number; measuredAt: Date }> => {
  const latest = new Map<string, { value: number; measuredAt: Date }>();

  for (const row of rows) {
    const value = numberOf(row._value);
    const measuredAt = row._time ? new Date(row._time) : null;
    if (!row._field || value === null || !measuredAt || Number.isNaN(measuredAt.getTime())) continue;

    const known = latest.get(row._field);
    if (!known || known.measuredAt < measuredAt) latest.set(row._field, { value, measuredAt });
  }

  return latest;
};

/**
 * The windows of a series read, as a grid: the instants in order, and each
 * field's value at each of them. `aggregateWindow` stamps every field's windows
 * identically, so the instant is what joins the fields a computed metric needs.
 */
export interface SeriesGrid {
  instants: string[];
  valuesByField: Map<string, Map<string, number | null>>;
}

export const gridOf = (rows: FluxRow[]): SeriesGrid => {
  const instants = new Set<string>();
  const valuesByField = new Map<string, Map<string, number | null>>();

  for (const row of rows) {
    if (!row._field || !row._time) continue;

    instants.add(row._time);
    const values = valuesByField.get(row._field) ?? new Map<string, number | null>();
    values.set(row._time, numberOf(row._value));
    valuesByField.set(row._field, values);
  }

  return { instants: [...instants].sort(), valuesByField };
};

/** The factors a device computes its own metrics with, as `devices.settings` holds them. */
export interface DeviceFactors {
  vpdLeafOffsetDay: number;
  vpdLeafOffsetNight: number;
  ppfdLuxFactor: number;
}

/** The readings a computed metric is built from, at one instant. */
export interface Readings {
  temperature: number | null;
  humidity: number | null;
  leafTemperature: number | null;
  lux: number | null;
  light: number | null;
}

export const readingsOf = (at: (field: string) => number | null): Readings => ({
  temperature: at(storedField('temperature')),
  humidity: at(storedField('humidity')),
  leafTemperature: at(storedField('leafTemperature')),
  lux: at(storedField('lux')),
  light: at(fieldOfOutputMetric('light')),
});

/** What each computed metric is built from, so one query fetches those fields with the rest. */
const FIELDS_OF_COMPUTED: Partial<Record<Metric, readonly string[]>> = {
  vpd: [storedField('temperature'), storedField('humidity'), storedField('leafTemperature'), fieldOfOutputMetric('light')],
  ppfd: [storedField('lux')],
};

/**
 * VPD, leaf-corrected. A measured leaf temperature wins; without one the air
 * temperature carries the device's own offset, which differs between day and
 * night because a leaf under a lamp is warmer than the air and a dark one is not.
 */
export const vpdOf = (readings: Readings, factors: DeviceFactors): number | null => {
  if (readings.temperature === null || readings.humidity === null) return null;

  const isDay = (readings.light ?? 0) > 0.5;
  const leaf = readings.leafTemperature ?? readings.temperature + (isDay ? factors.vpdLeafOffsetDay : factors.vpdLeafOffsetNight);

  return calculateVpd(readings.temperature, leaf, readings.humidity);
};

export const ppfdOf = (readings: Readings, factors: DeviceFactors): number | null =>
  readings.lux === null ? null : readings.lux * factors.ppfdLuxFactor;

/** What a computed metric is worth at one instant, or null where its inputs are missing. */
export const computedValue = (name: Metric, readings: Readings, factors: DeviceFactors): number | null => {
  switch (name) {
    case 'vpd':
      return vpdOf(readings, factors);
    case 'ppfd':
      return ppfdOf(readings, factors);
    default:
      // `offline` is derived from the device's own `state.lastSeenAt` rather
      // than from anything stored, and the device resource answers it.
      return null;
  }
};

/** Which fields a request has to read: the stored metrics themselves, and the inputs of the computed ones. */
export const fieldsFor = (metrics: readonly Metric[], outputs: readonly OutputMetric[]): string[] => {
  const fields = new Set<string>();

  for (const name of metrics) {
    const field = fieldOfMetric(name);
    if (field !== null) fields.add(field);
    else for (const input of FIELDS_OF_COMPUTED[name] ?? []) fields.add(input);
  }
  for (const output of outputs) fields.add(fieldOfOutputMetric(output));

  return [...fields];
};

export const pointsOf = (instants: string[], valueAt: (instant: string) => number | null): SeriesPoint[] =>
  instants.map(instant => ({ measuredAt: instant, value: valueAt(instant) }));
