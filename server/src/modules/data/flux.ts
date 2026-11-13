import { DeviceSettings, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { METRIC_DECIMALS } from '@fg2/shared-types/v1-schemas';
import { finiteOrNull } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { fieldOfMetric, fieldOfOutputMetric } from '@common/v1/metrics';
import { isSentinel, NO_CO2_VALVE } from '@common/v1/sentinels';

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
export const SAMPLE_MEASUREMENT = 'status';

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
 * Flux is built by interpolation, so what may be interpolated is spelled out
 * here. Without this a value that closes the query could append a pipeline of
 * its own - `-1h) |> yield() from(bucket: "…"` reads the whole bucket, which
 * holds every device of every customer. Instants and durations are formatted
 * from `Date` and `number` and so can carry nothing else.
 */
const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Points per series a read builds where the caller names no step. */
const MAX_WINDOWS = 1000;

/**
 * And where it names one: somebody looking closely - a day at a minute to the
 * point - is drawn the points they asked for, up to this many, and only a step
 * finer than that is widened.
 */
const MAX_ASKED_WINDOWS = 5000;

/** The narrowest step there is, picked or asked for: what a device reports at. */
export const MIN_STEP_SECONDS = 5;

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

const head = (bucket: string, deviceId: string, range: string, measurement = SAMPLE_MEASUREMENT): string => `
  from(bucket: "${safe(bucket, SAFE_NAME, 'bucket')}")
    |> range(${range})
    |> filter(fn: (r) => r["_measurement"] == "${measurement}")
    |> filter(fn: (r) => r["device_id"] == "${safe(deviceId, SAFE_NAME, 'device id')}")`;

const rangeOf = (window: TimeWindow): string => `start: ${window.startsAt.toISOString()}, stop: ${window.endsAt.toISOString()}`;

/** A row of any of these fields. */
const anyField = (fields: readonly string[]): string => fields.map(field => `r["_field"] == "${safe(field, FIELD_NAME, 'field name')}"`).join(' or ');

const aggregate = (window: FluxWindow, fn = 'mean', createEmpty = true): string => `
    |> aggregateWindow(every: ${Math.max(1, Math.trunc(window.stepSeconds))}s, fn: ${fn}, createEmpty: ${createEmpty})
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
  if (asked && asked > 0) return Math.max(Math.trunc(asked), MIN_STEP_SECONDS, Math.ceil(seconds / MAX_ASKED_WINDOWS));

  return Math.max(MIN_STEP_SECONDS, Math.ceil(seconds / MAX_WINDOWS));
};

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface FluxWindow extends TimeWindow {
  stepSeconds: number;
}

/** One aggregated point per window per field, empty windows included so a chart draws the gap rather than joining across it. */
export const seriesQuery = (bucket: string, deviceId: string, fields: readonly string[], window: FluxWindow): string =>
  `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(fields)})${aggregate(window)}`;

/** The two answers `extremesQuery` yields. */
const EXTREME_RESULT = { min: 'min', max: 'max' } as const;

/**
 * The lowest and the highest sample of every window of a series, beside the
 * mean `seriesQuery` answers: what a mean flattens - a door open for forty
 * seconds, a humidifier's burst - is what somebody opens a chart to find.
 *
 * Two more scans of the same fields, pushed down like the mean, and only of
 * raw samples: a day kept as its mean has no extremes left. Empty windows are
 * not created, since the mean's grid already carries them.
 */
export const extremesQuery = (bucket: string, deviceId: string, fields: readonly string[], window: FluxWindow): string =>
  Object.values(EXTREME_RESULT)
    .map(
      fn => `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(fields)})${aggregate(window, fn, false)}
    |> yield(name: "${fn}")`,
    )
    .join('\n');

/** The lowest and the highest of one window of one field. */
export interface Extremes {
  min: number;
  max: number;
}

/**
 * The rows of that read, by field and instant. A device whose points were once
 * tagged with an owner answers one table per tag, so two rows can name the
 * same window: the lower low and the higher high stand. A window either end of
 * which is a sentinel has no extremes - "no sensor" is not a reading, and the
 * true low behind it cannot be told.
 */
export const extremesByField = (rows: (FluxRow & { result?: string })[]): Map<string, Map<string, Extremes>> => {
  const byField = new Map<string, Map<string, Partial<Extremes> & { void?: true }>>();

  for (const row of rows) {
    const value = finiteOrNull(row._value);
    if (!row._field || !row._time || value === null) continue;
    const windows = byField.get(row._field) ?? new Map<string, Partial<Extremes> & { void?: true }>();
    const known = windows.get(row._time) ?? {};
    if (isSentinel(row._field, value)) known.void = true;
    else if (row.result === EXTREME_RESULT.min) known.min = Math.min(known.min ?? value, value);
    else known.max = Math.max(known.max ?? value, value);
    windows.set(row._time, known);
    byField.set(row._field, windows);
  }

  return new Map(
    [...byField].map(([field, windows]) => [
      field,
      new Map(
        [...windows].flatMap(([instant, one]) =>
          one.void || one.min === undefined || one.max === undefined ? [] : [[instant, { min: one.min, max: one.max }] as [string, Extremes]],
        ),
      ),
    ]),
  );
};

/**
 * How wide a window may be for its deficit to be worked out sample by sample:
 * three days of a device that reports every five seconds are some fifty
 * thousand samples.
 *
 * Measured on a tent of 120 days at 5 s (medians, on a developer machine):
 * read raw and worked out in the server a day costs 64 ms, a week 476 ms and
 * a month 2.2 s; the same in Flux - a pivot and the deficit of every row are
 * not pushed down - 305 ms, 2 s, 8.5 s and 34 s for the four months. A wider
 * window is therefore read as means over a grain (`grainsQuery`), which is
 * pushed down: 17 ms a week, 50 ms a month, 182 ms the four months at five
 * minutes.
 */
export const MAX_SAMPLED_SECONDS = 3 * 24 * 60 * 60;

/** The grain a wide window's deficit is worked out at: narrow enough that a change of the light cannot bend it. */
const DEFICIT_GRAIN_SECONDS = 300;

/** How many grains a read holds at the most, under the store's own limit per series (`MAX_POINTS`). */
const MAX_GRAINS = 40000;

/**
 * The grain for a window: five minutes, and for a window of more than four and
 * a half months as many whole five minutes as keep the read within its limit.
 */
export const deficitGrainFor = (window: TimeWindow): number => {
  const seconds = (window.endsAt.getTime() - window.startsAt.getTime()) / 1000;
  return Math.max(DEFICIT_GRAIN_SECONDS, Math.ceil(seconds / MAX_GRAINS / DEFICIT_GRAIN_SECONDS) * DEFICIT_GRAIN_SECONDS);
};

/**
 * Every raw sample of some fields over a window, as it was written: what a
 * value worked out from two readings needs. The deficit a tent held is the
 * deficit of a temperature and a humidity that met; the coldest and the
 * dampest sample of three minutes need not be the same one, and a deficit
 * built from both is one that never was.
 */
export const samplesQuery = (bucket: string, deviceId: string, fields: readonly string[], window: TimeWindow): string =>
  `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(fields)})
    |> keep(columns: ["_time", "_value", "_field"])`;

/** The same over several stretches in one script: the samples of the few grains a wide read has to look into (`switchedGrains`). */
export const samplesInQuery = (bucket: string, deviceId: string, fields: readonly string[], stretches: readonly TimeWindow[]): string => {
  const reads = stretches.map(stretch => samplesQuery(bucket, deviceId, fields, stretch));
  return reads.length === 1 ? reads[0] : `union(tables: [${reads.join(',')}])`;
};

/**
 * The same fields as means over a grain, for a window too wide to read sample
 * by sample. A grain of five minutes lies in one half of the day or the other
 * - a lamp switches inside two of them a day - so each is judged day or night
 * by its own time. Worked out from the means of a window as wide as the chart
 * draws - hours, over a grow - a deficit took one leaf offset for air of both
 * halves, in a pattern that drifted through the days: the same climate read
 * 0.92 to 1.2 kPa in one month and 1.0 to 1.1 in another.
 */
export const grainsQuery = (
  bucket: string,
  deviceId: string,
  fields: readonly string[],
  window: TimeWindow,
  grainSeconds: number,
  /** Two fields whose readings are counted grain by grain, for `coveredGrains`. */
  counted: readonly string[] = [],
): string => {
  const read = (names: readonly string[], fn: string) => `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(names)})
    |> aggregateWindow(every: ${Math.max(1, Math.trunc(grainSeconds))}s, fn: ${fn}, createEmpty: false)
    |> keep(columns: ["_time", "_value", "_field"])`;

  return counted.length === 0
    ? read(fields, 'mean')
    : `${read(fields, 'mean')}
    |> yield(name: "mean")
${read(counted, 'count')}
    |> yield(name: "${GRAIN_COUNT}")`;
};

/** The answer of `grainsQuery` that says how many readings a grain held. */
const GRAIN_COUNT = 'count';

/**
 * The grains' means without what does not cover its grain: a mean of `field` is kept only where the grain
 * held at least half as many readings of it as of `beside`. A leaf sensor that wrote once in five minutes is
 * no leaf temperature of those five minutes, and one stray reading bent the deficit of a whole grain.
 */
export const coveredGrains = (rows: readonly (FluxRow & { result?: string })[], field: string, beside: string): FluxRow[] => {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.result === GRAIN_COUNT && row._time && row._field) counts.set(`${row._field}@${row._time}`, finiteOrNull(row._value) ?? 0);
  const of = (name: string, time: string) => counts.get(`${name}@${time}`) ?? 0;

  return rows.filter(row => row.result !== GRAIN_COUNT && !(row._field === field && row._time && of(field, row._time) * 2 < of(beside, row._time)));
};

/** The rows of a read as readings: every instant with the value each field had at it. */
const readingsByInstant = (rows: readonly FluxRow[]): Map<string, Record<string, number>> => {
  const readings = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const value = finiteOrNull(row._value);
    if (!row._field || !row._time || value === null) continue;
    const reading = readings.get(row._time) ?? {};
    reading[row._field] = value;
    readings.set(row._time, reading);
  }

  return readings;
};

/**
 * The grains a change between day and night fell into, as the stretches to
 * read sample by sample: of two grains that follow one another and lie in
 * different halves, the lit one - the one a lamp switched in is lit by its
 * mean level, and its neighbour is dark throughout - or both, where the half
 * is not the lamp's to say (`both`: a fan's flag, a plug's schedule).
 *
 * A grain is judged day or night as a whole, and the one the lamp switched in
 * is neither: lit in six samples of ten it took the day's leaf offset for the
 * air of all ten, and a week's lowest deficit read 0.80 kPa where no sample
 * of it was below 0.90. So that grain is worked out as its lit and its dark
 * part, each from its own readings - two grains a day, and not a second read
 * of every one. A grain whose leaf temperature was measured is left alone:
 * the half decides the offset a missing leaf reading is replaced by, and
 * nothing else.
 */
export const switchedGrains = (
  rows: readonly FluxRow[],
  grainSeconds: number,
  dayOf: (at: (field: string) => number | null, time: number) => boolean | null,
  both: boolean,
): TimeWindow[] => {
  const grain = grainSeconds * 1000;
  const leaf = fieldOfMetric('leafTemperature') as string;
  const grains = [...readingsByInstant(rows)]
    .map(([instant, reading]) => {
      const stamp = Date.parse(instant);
      return { stamp, day: dayOf(field => reading[field] ?? null, stamp - grain / 2), measured: reading[leaf] !== undefined };
    })
    .sort((one, other) => one.stamp - other.stamp);

  return grains.flatMap((one, index) => {
    const before = grains[index - 1];
    if (!before || one.stamp - before.stamp !== grain || one.day === null || before.day === null || one.day === before.day) return [];
    const read = (both ? [before, one] : [one.day ? one : before]).filter(each => !each.measured);

    return read.length === 0 ? [] : [{ startsAt: new Date(read[0].stamp - grain), endsAt: new Date(read[read.length - 1].stamp) }];
  });
};

/** What a window's readings came to once each was worked out by itself: their mean, the lowest and the highest. */
export interface WorkedOut extends Extremes {
  mean: number;
}

/**
 * What `valueOf` makes of each reading - a sample, or the mean of a grain -
 * gathered by the window the reading fell into and keyed by the instant that
 * window is stamped with. `aggregateWindow` cuts its windows on the step from
 * the epoch, stamps each at its end and cuts the last to the range, and so
 * does this: the figures stand at the instants the other means stand at.
 *
 * A grain is itself stamped at its end, so its own time is half of itself
 * before that (`grainSeconds`); a sample's is its instant.
 */
export const workedOutBy = (
  rows: readonly FluxRow[],
  window: FluxWindow,
  valueOf: (at: (field: string) => number | null, time: number) => number | null,
  grainSeconds = 0,
): Map<number, WorkedOut> => {
  const readings = readingsByInstant(rows);
  const step = Math.max(1, Math.trunc(window.stepSeconds)) * 1000;
  const stop = window.endsAt.getTime();
  const gathered = new Map<number, { sum: number; count: number } & Extremes>();

  for (const [instant, reading] of readings) {
    const time = Date.parse(instant) - grainSeconds * 500;
    const value = valueOf(field => reading[field] ?? null, time);
    if (value === null || Number.isNaN(time)) continue;

    const stamped = Math.min(Math.floor(time / step) * step + step, stop);
    const known = gathered.get(stamped);
    if (!known) gathered.set(stamped, { sum: value, count: 1, min: value, max: value });
    else {
      known.sum += value;
      known.count += 1;
      known.min = Math.min(known.min, value);
      known.max = Math.max(known.max, value);
    }
  }

  return new Map([...gathered].map(([stamped, one]) => [stamped, { mean: one.sum / one.count, min: one.min, max: one.max }]));
};

/**
 * How finely an output's switchings are looked for at the most, whatever the
 * width of the window.
 *
 * It is a grain of its own and not simply the display step. An output is a
 * state and not a measurement: averaging it says what share of a window it ran
 * for, which at hours to the window is a duty cycle and never a cycle - an 18/6
 * lamp read at eleven hours to the window never falls low enough to be called
 * off, and a whole season of nights disappears. So the store is asked for the
 * switchings themselves, and a grow answers the same lamp a day answers.
 *
 * Five minutes is what keeps a long read cheap: a duty-cycled PID crosses zero
 * hundreds of thousands of times a season, and `max` over the grain collapses
 * that chatter in the store rather than in this process. A window read at a
 * finer step than that is read at the step (`switchingGrainFor`): somebody who
 * zoomed into twenty minutes is looking for the second a dehumidifier came on,
 * and a compressor's rest of four minutes never showed at five. A run is never
 * reported shorter than it was, and may be reported up to one grain longer at
 * either end.
 */
const SWITCHING_GRAIN_SECONDS = 300;

/** The grain a window's switchings are read at: its own step, between what a device reports at and the five minutes above. */
export const switchingGrainFor = (stepSeconds: number | undefined): number =>
  Math.min(SWITCHING_GRAIN_SECONDS, Math.max(MIN_STEP_SECONDS, Math.trunc(stepSeconds ?? SWITCHING_GRAIN_SECONDS)));

/**
 * A safety net, not a page size. Every output of a real 218-day season answers
 * a few hundred to a few thousand switchings; a device stuck flapping must not
 * become a read of everything.
 */
const MAX_SWITCHINGS = 10000;

/** A figure of the CO2 valve that is a count of openings rather than its "there is no valve", written in Flux. */
const REAL_VALVE_FIGURE = `r["_value"] >= 0.0 and r["_value"] != ${NO_CO2_VALVE}.0`;

/**
 * The one sentinel that has to be excluded in the store rather than on the way
 * back out, written in Flux.
 *
 * Everywhere else a sentinel can be recognised in this process, because the
 * figure survives the read. Here it does not: the switchings are reduced to a
 * `max` per grain and then mapped to "running" or "not" inside InfluxDB, so a
 * controller's "there is no valve" figure would arrive as a plain 1.0 with
 * nothing left to tell it from a valve that really ran. It says the same thing
 * as `isSentinel`, in the same field name and the same constant.
 */
const NOT_A_SENTINEL = `r["_field"] != "${fieldOfOutputMetric('co2')}" or (${REAL_VALVE_FIGURE})`;

/**
 * How often a device's CO2 valve opened over a stretch. Each sample counts the
 * openings since the one before it and starts again at nought, so the count of
 * a stretch is the sum of its samples, whatever the device's cadence was. The
 * "there is no valve" figure is left out in the store, where a sum would
 * otherwise swallow it.
 *
 * Only raw samples are counted. A day that has left an install's retention
 * window is kept as its mean, and a mean of counts says nothing about how many
 * samples it was taken over.
 */
export const valveOpeningsQuery = (bucket: string, deviceId: string, window: TimeWindow): string =>
  `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => r["_field"] == "${fieldOfOutputMetric('co2')}")
    |> filter(fn: (r) => ${REAL_VALVE_FIGURE})
    |> sum()`;

/** The two answers `countsQuery` yields: how many samples a window held of an output, and in how many of them it ran. */
const COUNT_RESULT = { heard: 'heard', on: 'on' } as const;

/**
 * How many samples of each output every drawn window holds, and in how many of
 * them the output was running: what every figure said about an output is
 * counted from, beside the mean the series read already answers.
 *
 * A figure taken from the runs instead - the stretches between two switchings,
 * each rounded out to the grain it was found at - called a valve that opens for
 * five seconds every two minutes open three quarters of the day, and a heater
 * a fifth of the time where its samples said an eighth.
 *
 * `counted` are the outputs driven at a level, and the valve. One that only
 * switches writes 0 or 1, so the mean of a window is already the share of its
 * samples it ran in, and it is left out of the second count: a filter on the
 * value is the one thing here the store does not push down - four months of
 * five outputs counted in 53 ms and counted above zero in 227 ms.
 * The valve's "there is no valve" figure is counted like any other; whoever
 * reads the counts drops a window whose mean is that figure (`gridOf`).
 * Only raw samples are read: a day kept as its mean has no samples left.
 */
export const countsQuery = (bucket: string, deviceId: string, fields: readonly string[], counted: readonly string[], window: FluxWindow): string => {
  const read = (names: readonly string[], kept: string, name: string) => `${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(names)})${kept}${aggregate(window, 'count', false)}
    |> yield(name: "${name}")`;

  return [
    read(fields, '', COUNT_RESULT.heard),
    ...(counted.length > 0 ? [read(counted, '\n    |> filter(fn: (r) => r._value > 0.0)', COUNT_RESULT.on)] : []),
  ].join('\n');
};

/** What one window held of one output: its samples, and those it ran in - null where they were not counted. */
export interface OutputCount {
  heard: number;
  on: number | null;
}

/**
 * The rows of that read, per field and window. A device whose points were once
 * tagged with an owner answers one table per tag, so two rows can name the
 * same window, and their samples are added up.
 */
export const countsByField = (rows: (FluxRow & { result?: string })[]): Map<string, Map<string, OutputCount>> => {
  const byField = new Map<string, Map<string, OutputCount>>();

  for (const row of rows) {
    const value = finiteOrNull(row._value);
    if (!row._field || !row._time || value === null) continue;
    const windows = byField.get(row._field) ?? new Map<string, OutputCount>();
    const known = windows.get(row._time) ?? { heard: 0, on: null };
    windows.set(row._time, row.result === COUNT_RESULT.on ? { ...known, on: (known.on ?? 0) + value } : { ...known, heard: known.heard + value });
    byField.set(row._field, windows);
  }

  return byField;
};

/** When the first or the last sample of one drawn window was written - whichever of them was asked for. */
export interface SampleEdges {
  first?: number;
  last?: number;
}

/** A window whose first or last sample is asked for, by the instant the window is stamped with. */
export interface EdgeAsked extends TimeWindow {
  end: 'first' | 'last';
}

/**
 * When the first or the last sample of some windows was written, of whichever
 * field: a device is heard when any of its fields reports, so the read names
 * none - asked of one field, a heater that began reporting later than its
 * controller moved a lamp's edges by up to a step.
 *
 * A window says that something was heard in it, not when: a device back at
 * 16:00 has a point at 16:03 at three minutes to the point and at 16:30 at an
 * hour and a half, and one that fell silent at 16:18 a last point at 17:00 at
 * an hour. Only the windows either side of a silence are asked about, each a
 * `first()` or a `last()` over one step, so a device without silences costs
 * nothing and one with them about a millisecond an edge.
 */
export const edgesQuery = (bucket: string, deviceId: string, asked: readonly EdgeAsked[]): string => {
  const reads = asked.map(
    one => `${head(bucket, deviceId, rangeOf(one))}
    |> ${one.end}()
    |> keep(columns: ["_time", "_field"])`,
  );
  return reads.length === 1 ? reads[0] : `union(tables: [${reads.join(',')}])`;
};

/** The rows of that read by the instant each asked window is stamped with: the earliest of its `first` rows, the latest of its `last`. */
export const edgesOf = (rows: readonly FluxRow[], asked: readonly EdgeAsked[]): Map<number, SampleEdges> => {
  const times = rows.flatMap(row => (row._time ? [Date.parse(row._time)] : [])).filter(time => !Number.isNaN(time));
  const edges = new Map<number, SampleEdges>();

  for (const one of asked) {
    const [from, to] = [one.startsAt.getTime(), one.endsAt.getTime()];
    const inside = times.filter(time => time >= from && time <= to);
    if (inside.length === 0) continue;
    edges.set(to, { ...edges.get(to), [one.end]: one.end === 'first' ? Math.min(...inside) : Math.max(...inside) });
  }

  return edges;
};

/**
 * The windows either side of every silence in a row of stamps: the one a
 * stretch of what was heard begins in (its first sample) and the one it ends
 * in (its last). The first stretch begins in the read's first window only if
 * that is not the first there is, and the last ends at the device's newest
 * sample, which the read knows without this.
 */
export const edgesAround = (stamps: readonly number[], window: FluxWindow): EdgeAsked[] => {
  const step = Math.max(1, Math.trunc(window.stepSeconds)) * 1000;
  const [starts, stop] = [window.startsAt.getTime(), window.endsAt.getTime()];
  // A window is cut on the step from the epoch and stamped at its end, the last one where the read ends.
  const asked = (stamp: number, end: EdgeAsked['end']): EdgeAsked => ({
    startsAt: new Date(Math.max(starts, stamp === stop && stamp % step !== 0 ? stamp - (stamp % step) : stamp - step)),
    endsAt: new Date(stamp),
    end,
  });

  return stamps.flatMap((stamp, index) => [
    ...((index === 0 ? stamp - step > starts : stamp - stamps[index - 1] > step) ? [asked(stamp, 'first')] : []),
    ...(index < stamps.length - 1 && stamps[index + 1] - stamp > step ? [asked(stamp, 'last')] : []),
  ]);
};

/** One drawn window of one output, counted from its samples. */
export interface OutputFigure {
  measuredAt: string;
  /** How many samples the window held. */
  heard: number;
  /** In how many of them the output was running. */
  on: number;
  /** The mean of all of them as the device wrote them, a sample in which it was off counting as the 0 it is. */
  mean: number;
}

/**
 * One output's figures: for every window the series holds a mean of it, the
 * samples counted there. The mean is the series' own - of every sample, off or
 * on - and a window whose mean is the valve's "there is no valve" has none
 * (`gridOf`), so it has no figure either. An output that only switches
 * (`switches`) writes 0 or 1, and the samples it ran in are its mean of them all.
 */
export const figuresOf = (points: readonly SeriesPoint[], counts: ReadonlyMap<string, OutputCount> | undefined, switches: boolean): OutputFigure[] =>
  points.flatMap(point => {
    const counted = counts?.get(point.measuredAt);
    if (point.value === null || !counted || counted.heard <= 0) return [];
    const on = counted.on ?? (switches ? Math.round(point.value * counted.heard) : 0);

    return [{ measuredAt: point.measuredAt, heard: counted.heard, on: Math.min(counted.heard, Math.max(0, on)), mean: point.value }];
  });

/** The two answers `switchingsQuery` yields, which is what tells the state a window opens in from a switching inside it. */
const SWITCHING_RESULT = { opening: 'opening', switching: 'switching' } as const;

/** One thing an output did: the instant it was first reported doing it, and whether it was running. */
export interface OutputSwitching {
  at: string;
  on: boolean;
}

/**
 * When each output started and stopped running, rather than what it averaged.
 *
 * Two answers come back from one scan. `opening` is the state the window is
 * found in, without which a lamp that never switched inside the window could be
 * either lit throughout or dark throughout; `switching` is every crossing after
 * it, as `+1` and `-1`, so the rows are as many as the output really switched
 * and not as many as the window has steps.
 *
 * "Running" is anything above zero rather than a share of the scale. The scales
 * differ per output and per hardware - `light` is a percentage, `heater` a 0..1
 * PID, `dehumidifier` and `relais` are 0 or 1 - so a threshold in the middle
 * means a different thing on every one of them, while "the device was driving
 * it" means the same thing on all of them.
 *
 * The tables are left grouped as the store grouped them: a `group()` here would
 * stop InfluxDB pushing the aggregate down into the storage engine, which is the
 * difference between half a second and half a minute over a season.
 */
export const switchingsQuery = (
  bucket: string,
  deviceId: string,
  fields: readonly string[],
  window: TimeWindow,
  grainSeconds = SWITCHING_GRAIN_SECONDS,
): string =>
  `runs = ${head(bucket, deviceId, rangeOf(window))}
    |> filter(fn: (r) => ${anyField(fields)})
    |> filter(fn: (r) => ${NOT_A_SENTINEL})
    |> aggregateWindow(every: ${grainSeconds}s, fn: max, createEmpty: false, timeSrc: "_start")
    |> map(fn: (r) => ({ r with _value: if r._value > 0.0 then 1.0 else 0.0 }))
runs |> first() |> yield(name: "${SWITCHING_RESULT.opening}")
runs
    |> difference(nonNegative: false, columns: ["_value"])
    |> filter(fn: (r) => r._value != 0.0)
    |> limit(n: ${MAX_SWITCHINGS})
    |> yield(name: "${SWITCHING_RESULT.switching}")`;

/**
 * The rows of that read, gathered per field and in order.
 *
 * Both yields carry the same sign convention - above zero is running - so the
 * opening state and a switching are read the same way. A device whose points
 * were once tagged with an owner answers one table per tag as well as per
 * field, so the rows are merged by instant and a state repeated is dropped:
 * what a lane draws is when the output changed, and saying it twice would cut a
 * run into two that touch.
 */
export const switchingsByField = (rows: FluxRow[]): Map<string, OutputSwitching[]> => {
  const byField = new Map<string, OutputSwitching[]>();

  for (const row of rows) {
    const value = finiteOrNull(row._value);
    if (!row._field || !row._time || value === null) continue;
    byField.set(row._field, [...(byField.get(row._field) ?? []), { at: row._time, on: value > 0 }]);
  }

  return new Map(
    [...byField].map(([field, switchings]) => [
      field,
      switchings
        .sort((one, other) => one.at.localeCompare(other.at))
        .filter((switching, index, all) => index === 0 || switching.on !== all[index - 1].on),
    ]),
  );
};

/** A stretch an output ran for, in milliseconds, which is what a bucket can be laid over. */
export interface RunningSpan {
  from: number;
  to: number;
}

/**
 * The stretches an output was running for, out of the switchings the store
 * answered for it. The first row is the state the window opened in and the rest
 * are the crossings after it, so a stretch runs from the switching that started
 * it to the next one; the last runs on without end, because nothing after it
 * says otherwise.
 */
export const runningSpansOf = (switchings: readonly OutputSwitching[]): RunningSpan[] =>
  switchings.flatMap((switching, index) =>
    switching.on
      ? [{ from: Date.parse(switching.at), to: switchings[index + 1] ? Date.parse(switchings[index + 1].at) : Number.POSITIVE_INFINITY }]
      : [],
  );

/** How long those stretches cover of one window, in milliseconds: what an output really ran for inside it. */
export const runningFor = (spans: readonly RunningSpan[], from: number, to: number): number =>
  spans.reduce((sum, span) => sum + Math.max(0, Math.min(to, span.to) - Math.max(from, span.from)), 0);

/**
 * The days that have already been summarised, read back as they were stored.
 *
 * They are not aggregated a second time. A summary is one point a day and the
 * step a chart asked for is finer than that, so windowing them would only spread
 * each day over the empty windows around it; the points go into the same grid as
 * the raw ones at the instants they carry, which is the start of their day.
 */
export const summaryQuery = (bucket: string, deviceId: string, fields: readonly string[], window: TimeWindow): string =>
  `${head(bucket, deviceId, rangeOf(window), SUMMARY_MEASUREMENT)}
    |> filter(fn: (r) => ${anyField(fields)})
    |> limit(n: ${MAX_POINTS})`;

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
 * The newest raw sample a device wrote from an instant on - up to another, or
 * to the present - whatever field it was of: the last instant it was heard from
 * at all.
 *
 * It is asked for separately because the windowed read cannot answer it: an
 * aggregation window carries the instant it closes rather than the instant the
 * sample inside it was taken, so the last point of a series stands up to a
 * whole step later than anything the device really said. `last()` answers one
 * row per field and the latest of them is the answer, in the same shape and at
 * the same cost as a live read.
 *
 * It names one device in an equality, which is what makes it answerable. A set
 * of devices reads naturally as `contains(value: r["device_id"], set: [...])`
 * and costs one read for a whole fleet, but that filter is not pushed down to
 * the storage engine: the `last()` behind it is then computed in memory over
 * every point in the range, of every series in the bucket, however few ids are
 * in the set. Against a migrated fleet, whose oldest silence reaches back most
 * of a year, such a read does not return at all. A tag equality is pushed down
 * and answers from the index instead, so the question is asked one device at a
 * time - and each of those reads can start at that device's own last message
 * rather than at the oldest of everybody's, which is the only instant that can
 * answer anything about it.
 */
export const newestSampleQuery = (bucket: string, deviceId: string, startsAt: Date, endsAt?: Date): string => `${head(
  bucket,
  deviceId,
  `start: ${startsAt.toISOString()}${endsAt ? `, stop: ${endsAt.toISOString()}` : ''}`,
)}
    |> last()`;

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
export const dailyMeanQuery = (bucket: string, deviceId: string, window: TimeWindow): string => `${head(bucket, deviceId, rangeOf(window))}
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
  `_measurement="${SAMPLE_MEASUREMENT}" AND device_id="${safe(deviceId, SAFE_NAME, 'device id')}"`;

/** Every point one device ever wrote: its raw samples and the daily summaries made of them. */
export const everySamplePredicate = (deviceId: string): string => `device_id="${safe(deviceId, SAFE_NAME, 'device id')}"`;

/** A row as the client hands it back. `_value` is empty for a window that holds no reading. */
export interface FluxRow {
  _time?: string;
  _value?: number | null;
  _field?: string;
  device_id?: string;
}

/** The instants the rows carry, those that are instants at all. */
export const instantsOf = (rows: readonly FluxRow[]): number[] => rows.map(row => (row._time ? Date.parse(row._time) : NaN)).filter(Number.isFinite);

/**
 * The newest reading of each field, by field name.
 *
 * A sentinel is passed over rather than answered as the newest point. Years of
 * stored samples were written before the ingest knew to drop them, and the live
 * read looks a month back, so a controller with no CO2 sensor would otherwise go
 * on reporting its "no sensor" figure as the freshest thing it measured.
 */
export const latestByField = (rows: FluxRow[]): Map<string, { value: number; measuredAt: Date }> => {
  const latest = new Map<string, { value: number; measuredAt: Date }>();

  for (const row of rows) {
    const value = finiteOrNull(row._value);
    const measuredAt = row._time ? new Date(row._time) : null;
    if (!row._field || value === null || !measuredAt || Number.isNaN(measuredAt.getTime())) continue;
    if (isSentinel(row._field, value)) continue;

    const known = latest.get(row._field);
    if (!known || known.measuredAt < measuredAt) latest.set(row._field, { value, measuredAt });
  }

  return latest;
};

/**
 * The windows of a series read, as a grid: the instants in order, and each
 * field's value at each of them. `aggregateWindow` stamps every field's windows
 * identically, so the instant is what joins the fields a computed metric needs.
 *
 * A window whose figure is a sentinel is a window with no reading in it, and is
 * kept as the gap it is rather than dropped: a chart draws the hole rather than
 * joining across it, which is what an unfitted sensor really leaves behind.
 */
interface SeriesGrid {
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
    const read = finiteOrNull(row._value);
    const value = read !== null && isSentinel(row._field, read) ? null : read;
    if (!(value === null && known !== null && known !== undefined)) values.set(row._time, value);
    valuesByField.set(row._field, values);
  }

  return { instants: [...instants].sort(), valuesByField };
};

/** The readings a computed metric is built from, at one instant. */
interface Readings {
  temperature: number | null;
  humidity: number | null;
  leafTemperature: number | null;
  lux: number | null;
  light: number | null;
  /** Which half of the cycle this reading belongs to, where the caller knows; null leaves it to be read off `light`. */
  isDay: boolean | null;
}

export const readingsOf = (at: (field: string) => number | null, isDay: boolean | null = null): Readings => ({
  temperature: at(storedField('temperature')),
  humidity: at(storedField('humidity')),
  leafTemperature: at(storedField('leafTemperature')),
  lux: at(storedField('lux')),
  light: at(fieldOfOutputMetric('light')),
  isDay,
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
 *
 * Which of the two applies is the caller's to say wherever the caller can say
 * it. A reading of a *window* only carries what `out_light` averaged over that
 * window, and that average is a duty cycle rather than a state: a lamp dimmed
 * to 15 % for an hour and a lamp at 100 % for nine minutes of it come to the
 * same figure, and any threshold on it means something different on every
 * output - which is the argument `switchingsQuery` already makes. Read that
 * way, a bucket 93 % of which was dark took the day offset because the lamp
 * came on for its last few minutes, and the deficit it answered was a third
 * too low under a night the same answer shades. A single sample has no window
 * to average over, so there the reported level does answer for itself and the
 * caller says nothing. An AIR fan has no lamp but reports its half, which the
 * caller passes on. A smart plug has neither: its half is its own schedule or
 * what the cameras where it stands saw, which the caller says (`plugDayIn`),
 * and the night where neither can.
 *
 * The curve is the contract's, because the targets screen works out the VPD of
 * a setpoint from the same one, and the figure is rounded as every VPD goes out.
 */
/**
 * Which half of the cycle a reading lies in. One whose own lamp level is zero
 * was taken in the dark, whatever the caller's cycle says; else the caller's
 * word, and the lamp's level where the caller has none.
 */
export const litOf = (readings: Pick<Readings, 'light' | 'isDay'>): boolean =>
  readings.light === 0 ? false : (readings.isDay ?? (readings.light ?? 0) > 0.5);

export const vpdOf = (readings: Readings, factors: DeviceSettings): number | null => {
  if (readings.temperature === null || readings.humidity === null) return null;

  const leaf = readings.leafTemperature ?? readings.temperature + (litOf(readings) ? factors.vpdLeafOffsetDay : factors.vpdLeafOffsetNight);

  return parseFloat(vapourPressureDeficit(readings.temperature, leaf, readings.humidity).toFixed(METRIC_DECIMALS.vpd));
};

const ppfdOf = (readings: Readings, factors: DeviceSettings): number | null => (readings.lux === null ? null : readings.lux * factors.ppfdLuxFactor);

/** What a computed metric is worth at one instant, or null where its inputs are missing. */
export const computedValue = (name: Metric, readings: Readings, factors: DeviceSettings): number | null => {
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
    const value = finiteOrNull(row._value);
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
