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
  field?: string;
  deviceId?: string;
  every?: string;
  fn: AggregateFn;
  createEmpty: boolean;
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
  field: literal(query, /r\["_field"\]\s*==\s*"([^"]*)"/),
  deviceId: literal(query, /r\["device_id"\]\s*==\s*"([^"]*)"/),
  every: literal(query, /aggregateWindow\([^)]*every:\s*([^,)\s]+)/),
  fn: (literal(query, /aggregateWindow\([^)]*fn:\s*([a-zA-Z]+)/) ?? 'mean') as AggregateFn,
  createEmpty: /createEmpty:\s*true/.test(query),
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
      (!parsed.field || parsed.field in point.fields),
  );

  const field = parsed.field ?? '';
  const measurement = parsed.measurement ?? 'status';
  const tagsOf = (index: number) => matching[index]?.tags ?? {};

  const every = parsed.every ? parseDuration(parsed.every) : NaN;
  if (!Number.isFinite(every) || every <= 0) {
    return {
      start,
      stop,
      rows: matching.map(point => ({
        time: point.time,
        value: point.fields[field] ?? null,
        field,
        measurement,
        deviceId: point.tags.device_id ?? '',
        userId: point.tags.user_id ?? '',
      })),
    };
  }

  const buckets = new Map<number, number[]>();
  for (const point of matching) {
    // Windows cover (windowStart, windowStop], so a point exactly on a boundary
    // belongs to the window that ends there.
    const windowStop = Math.ceil(point.time / every) * every;
    if (!buckets.has(windowStop)) buckets.set(windowStop, []);
    buckets.get(windowStop).push(point.fields[field]);
  }

  const rows: ResultRow[] = [];
  // The first window is the one that ends strictly after the range start.
  const firstWindow = Math.floor(start / every) * every + every;
  const identity = { deviceId: parsed.deviceId ?? tagsOf(0).device_id ?? '', userId: tagsOf(0).user_id ?? '' };

  if (parsed.createEmpty) {
    for (let windowStop = firstWindow; rows.length < MAX_ROWS; windowStop += every) {
      // Influx truncates the final window to the end of the range.
      const time = Math.min(windowStop, stop);
      rows.push({ time, value: aggregate(buckets.get(windowStop) ?? [], parsed.fn), field, measurement, ...identity });
      if (windowStop >= stop) break;
    }
  } else {
    for (const windowStop of [...buckets.keys()].sort((a, b) => a - b)) {
      rows.push({
        time: Math.min(windowStop, stop),
        value: aggregate(buckets.get(windowStop), parsed.fn),
        field,
        measurement,
        ...identity,
      });
    }
  }

  return { rows, start, stop };
};
