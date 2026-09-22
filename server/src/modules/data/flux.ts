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
 * Where a day that has left the retention window ends up: one point per field
 * per day, the mean of the raw samples of that day, stamped at the day's start.
 *
 * It is a measurement of its own rather than a coarser row in `status`, so that
 * nothing has to tell a summary from a sample by its spacing: the sweep reads
 * and deletes `status` alone and can be run twice without summarising its own
 * summaries, and a read that wants the years back asks for both by name.
 */
export const SUMMARY_MEASUREMENT = 'status_daily';

/** Days are cut in UTC, because the points are stamped in it and a summary must not move when somebody changes their time zone. */
const A_DAY = '1d';

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

const rangeOf = (window: Omit<FluxWindow, 'stepSeconds'>): string => `start: ${window.startsAt.toISOString()}, stop: ${window.endsAt.toISOString()}`;

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
 * The days that have already been summarised, read back as they were stored.
 *
 * They are not aggregated a second time. A summary is one point a day and the
 * step a chart asked for is finer than that, so windowing them would only spread
 * each day over the empty windows around it; the points go into the same grid as
 * the raw ones at the instants they carry, which is the start of their day.
 */
export const summaryQuery = (bucket: string, deviceId: string, fields: readonly string[], window: Omit<FluxWindow, 'stepSeconds'>): string => {
  const filter = fields.map(field => `r["_field"] == "${safe(field, FIELD_NAME, 'field name')}"`).join(' or ');

  return `
  from(bucket: "${safe(bucket, SAFE_NAME, 'bucket')}")
    |> range(${rangeOf(window)})
    |> filter(fn: (r) => r["_measurement"] == "${SUMMARY_MEASUREMENT}")
    |> filter(fn: (r) => r["device_id"] == "${safe(deviceId, SAFE_NAME, 'device id')}")
    |> filter(fn: (r) => ${filter})
    |> limit(n: ${MAX_POINTS})`;
};

/**
 * The oldest raw sample a device still has that is older than an instant, which
 * is where the retention sweep starts its next pass.
 *
 * The sweep keeps no bookmark of its own: where it has got to is what is left in
 * the store, so a pass that was interrupted half way through costs the next one
 * nothing and a server that was down for a month catches up a chunk at a time.
 * `first()` answers one row per field; the earliest of them is the answer.
 */
export const oldestSampleQuery = (bucket: string, deviceId: string, before: Date): string => `${head(
  bucket,
  deviceId,
  `start: 0, stop: ${before.toISOString()}`,
)}
    |> first()`;

/**
 * A stretch of a device's raw samples as one figure a day.
 *
 * The store does the arithmetic. A year of thirty-second samples is a million
 * points per field, and reading them into this process to average them is the
 * difference between a sweep that runs on an install with years behind it and
 * one that does not. Empty days are not created: a device that was unplugged
 * for a week leaves that week absent rather than as seven rows of nothing.
 *
 * `timeSrc` stamps each day at its start rather than at its end, so a summary
 * falls inside the day it is about.
 */
export const dailyMeanQuery = (bucket: string, deviceId: string, window: Omit<FluxWindow, 'stepSeconds'>): string => `${head(
  bucket,
  deviceId,
  rangeOf(window),
)}
    |> aggregateWindow(every: ${A_DAY}, fn: mean, createEmpty: false, timeSrc: "_start")
    |> limit(n: ${MAX_POINTS})`;

/**
 * Which points a delete is to take: one device's raw samples and nothing else.
 *
 * It is built here with the rest of what is sent to the store, and through the
 * same check, because it is interpolated the same way and names the one
 * measurement that must be spared - the summaries the sweep has just written
 * stand in `status_daily`.
 */
export const rawSamplePredicate = (deviceId: string): string =>
  `_measurement="${MEASUREMENT}" AND device_id="${safe(deviceId, SAFE_NAME, 'device id')}"`;

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
    // A reading already at that instant is never replaced by nothing. Two reads
    // build one grid - the raw samples and the daily summaries behind them -
    // and an empty window of the one falls on the start of a day the other has
    // a figure for, which would otherwise blank it.
    const known = values.get(row._time);
    const value = numberOf(row._value);
    if (!(value === null && known !== null && known !== undefined)) values.set(row._time, value);
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

/** One day of a device, as it will be written: the instant the day starts, and every field that had a reading in it. */
export interface DailySummary {
  at: Date;
  fields: Record<string, number>;
}

/**
 * The rows of a daily aggregate, gathered into the points that are written.
 *
 * One row per field per day comes back and one point per day goes in, so the
 * rows are grouped by the instant they share. A window whose mean is not a
 * number is left out rather than written as one: Influx renders an aggregate of
 * nothing as an empty cell, and a field that is absent from a summary says the
 * device measured nothing that day, where a zero would say it measured zero.
 *
 * A day that ends up with no field at all is not a point. Writing it would cost
 * a row to say nothing, and the sweep would then have no way of telling a day
 * it has summarised from a day there was nothing to summarise.
 */
export const dailySummariesOf = (rows: FluxRow[]): DailySummary[] => {
  const days = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const value = numberOf(row._value);
    if (!row._field || !row._time || value === null) continue;

    const fields = days.get(row._time) ?? {};
    fields[row._field] = value;
    days.set(row._time, fields);
  }

  return [...days]
    .filter(([, fields]) => Object.keys(fields).length > 0)
    .map(([instant, fields]) => ({ at: new Date(instant), fields }))
    .filter(day => !Number.isNaN(day.at.getTime()))
    .sort((one, other) => one.at.getTime() - other.at.getTime());
};

/** The start of the UTC day an instant falls in, which is where a summary is stamped and where a sweep's chunks begin and end. */
export const startOfDay = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
