import { InfluxPoint } from './stores';

/**
 * The slice of Flux the server actually sends. Only what data.service.ts builds
 * is understood; anything else is ignored rather than rejected, so a query that
 * gains an unrelated clause keeps working.
 */
export interface ParsedFlux {
  bucket: string;
  start: string;
  stop: string;
  measurement?: string;
  /** Empty means the query names no field, which is every field the device wrote. */
  fields: string[];
  deviceId?: string;
  /** Several devices in one query, which answers one series per device. */
  deviceIds?: string[];
  every?: string;
  fn: AggregateFn;
  createEmpty: boolean;
  /** A bare `|> last()`, which the live read uses instead of a window. */
  last: boolean;
  /**
   * The switchings read: a windowed `max` mapped to on-or-off and then run
   * through `difference`, which answers the state each field is found in and
   * every crossing after it rather than one row per window.
   */
  switchings: boolean;
  /** `timeSrc: "_start"` stamps a window at its start rather than at its stop, which is what the switchings read asks for. */
  timeAtStart: boolean;
}

export type AggregateFn = 'mean' | 'min' | 'max' | 'sum' | 'last' | 'first' | 'count';

/** The `limit(n:)` the server's own queries carry, so a wide range with a small
 * interval cannot build an unbounded list here either. */
const MAX_ROWS = 50_000;

const DURATION_UNITS_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** `-3d`, `1h30m`, `500ms` -> milliseconds. Returns NaN for anything else. */
export const parseDuration = (value: string): number => {
  const match = /^(-)?((\d+(?:\.\d+)?(?:ns|us|ms|s|m|h|d|w))+)$/.exec(value.trim());
  if (!match) return NaN;

  let total = 0;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ns|us|ms|s|m|h|d|w)/g)) {
    total += parseFloat(amount) * DURATION_UNITS_MS[unit];
  }
  return match[1] ? -total : total;
};

/** A Flux time literal (`now()`, `-3d`, RFC3339, unix seconds) as epoch millis. */
export const resolveTime = (value: string, now: number): number => {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '' || trimmed === 'now()') return now;

  const duration = parseDuration(trimmed);
  if (!Number.isNaN(duration)) return now + duration;

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;

  // Bare numbers are unix seconds, which is what the webapp sends.
  const seconds = Number(trimmed);
  return Number.isFinite(seconds) ? seconds * 1000 : now;
};

const literal = (query: string, pattern: RegExp): string | undefined => pattern.exec(query)?.[1];

export const parseFlux = (query: string): ParsedFlux => ({
  bucket: literal(query, /from\(bucket:\s*"([^"]*)"\)/) ?? '',
  start: literal(query, /range\(start:\s*([^,)\s]+)/) ?? '-1h',
  stop: literal(query, /range\([^)]*stop:\s*([^,)\s]+)/) ?? 'now()',
  measurement: literal(query, /r\["_measurement"\]\s*==\s*"([^"]*)"/),
  fields: [...query.matchAll(/r\["_field"\]\s*==\s*"([^"]*)"/g)].map(match => match[1]),
  deviceId: literal(query, /r\["device_id"\]\s*==\s*"([^"]*)"/),
  deviceIds: literal(query, /contains\(value:\s*r\["device_id"\],\s*set:\s*\[([^\]]*)\]/)
    ?.match(/"([^"]*)"/g)
    ?.map(quoted => quoted.slice(1, -1)),
  every: literal(query, /aggregateWindow\([^)]*every:\s*([^,)\s]+)/),
  fn: (literal(query, /aggregateWindow\([^)]*fn:\s*([a-zA-Z]+)/) ?? 'mean') as AggregateFn,
  createEmpty: /createEmpty:\s*true/.test(query),
  last: /\|>\s*last\(\)/.test(query),
  switchings: /\|>\s*difference\(/.test(query),
  timeAtStart: /timeSrc:\s*"_start"/.test(query),
});

const aggregate = (values: number[], fn: AggregateFn): number | null => {
  if (values.length === 0) return null;
  switch (fn) {
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'last':
      return values[values.length - 1];
    case 'first':
      return values[0];
    case 'count':
      return values.length;
    case 'mean':
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
};

export interface ResultRow {
  time: number;
  value: number | null;
  field: string;
  measurement: string;
  deviceId: string;
  userId: string;
}

/**
 * Influx `aggregateWindow` semantics: windows are aligned to the epoch, cover
 * (start, stop], and are stamped with the window's stop time.
 */
export const runQuery = (points: InfluxPoint[], parsed: ParsedFlux, now: number): { rows: ResultRow[]; start: number; stop: number } => {
  const start = resolveTime(parsed.start, now);
  const stop = resolveTime(parsed.stop, now);

  const matching = points.filter(
    point =>
      point.time > start &&
      point.time <= stop &&
      (!parsed.measurement || point.measurement === parsed.measurement) &&
      (!parsed.deviceId || point.tags.device_id === parsed.deviceId) &&
      (!parsed.deviceIds || parsed.deviceIds.includes(point.tags.device_id)),
  );

  // A device is a series of its own, as the tag makes it in Influx; a query
  // over several devices answers each one's windows, not one aggregate of all.
  const series = parsed.deviceIds
    ? parsed.deviceIds.map(deviceId => matching.filter(point => point.tags.device_id === deviceId)).filter(own => own.length > 0)
    : [matching];

  const rows = series.flatMap(own => {
    // A query that names no field reads every field the device has written, which
    // is what the live read does: one row per field rather than one per point.
    const fields = parsed.fields.length > 0 ? parsed.fields : [...new Set(own.flatMap(point => Object.keys(point.fields)))];
    return fields.flatMap(field => fieldRows(own, field, parsed, start, stop));
  });
  return { rows, start, stop };
};

const fieldRows = (matching: InfluxPoint[], field: string, parsed: ParsedFlux, start: number, stop: number): ResultRow[] => {
  const measurement = parsed.measurement ?? 'status';
  const written = matching.filter(point => field in point.fields);
  const identity = {
    field,
    measurement,
    deviceId: parsed.deviceId ?? written[0]?.tags.device_id ?? '',
    userId: written[0]?.tags.user_id ?? '',
  };

  const every = parsed.every ? parseDuration(parsed.every) : NaN;
  if (!Number.isFinite(every) || every <= 0) {
    const points = parsed.last ? written.slice(-1) : written;
    return points.map(point => ({ time: point.time, value: point.fields[field] ?? null, ...identity }));
  }

  const buckets = new Map<number, number[]>();
  for (const point of written) {
    // Windows cover (windowStart, windowStop], so a point exactly on a boundary
    // belongs to the window that ends there.
    const windowStop = Math.ceil(point.time / every) * every;
    let bucket = buckets.get(windowStop);
    if (!bucket) {
      bucket = [];
      buckets.set(windowStop, bucket);
    }
    bucket.push(point.fields[field]);
  }

  const rows: ResultRow[] = [];
  // The first window is the one that ends strictly after the range start.
  const firstWindow = Math.floor(start / every) * every + every;
  // Influx truncates the final window to the end of the range, and `timeSrc`
  // decides which end of a window a row is stamped at.
  const stamp = (windowStop: number): number => (parsed.timeAtStart ? Math.max(start, windowStop - every) : Math.min(windowStop, stop));

  if (parsed.createEmpty) {
    for (let windowStop = firstWindow; rows.length < MAX_ROWS; windowStop += every) {
      rows.push({ time: stamp(windowStop), value: aggregate(buckets.get(windowStop) ?? [], parsed.fn), ...identity });
      if (windowStop >= stop) break;
    }
  } else {
    for (const windowStop of [...buckets.keys()].sort((a, b) => a - b)) {
      rows.push({
        time: stamp(windowStop),
        // The loop walks the buckets' own keys.
        value: aggregate(buckets.get(windowStop)!, parsed.fn),
        ...identity,
      });
    }
  }

  return parsed.switchings ? crossings(rows) : rows;
};

/**
 * What `difference()` over a mapped series leaves: the first row as the state
 * the window opens in, and after it only the rows where the state changed,
 * carrying the change itself. Both read the same way - above zero is running -
 * which is what lets one query answer them together.
 */
const crossings = (rows: ResultRow[]): ResultRow[] => {
  let last: boolean | null = null;

  return rows.flatMap(row => {
    const on = (row.value ?? 0) > 0;
    if (on === last) return [];

    const written = last === null ? (on ? 1 : 0) : on ? 1 : -1;
    last = on;

    return [{ ...row, value: written }];
  });
};
