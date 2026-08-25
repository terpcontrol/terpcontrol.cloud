import { fluxDateTime, fluxDuration } from '@influxdata/influxdb-client';

/**
 * Flux is a query language, and the series endpoints take their measure, their
 * time bounds and their window straight from a URL. The `flux` template tag
 * escapes what it interpolates, but only for values handed to it as typed Flux
 * values - a plain string is pasted in verbatim, and a measure named
 * `x" or true or r["_field"] == "y` would rewrite the query around it.
 *
 * So every parameter is converted to its Flux type here. A value that does not
 * convert is replaced by a safe default rather than passed on, which is how the
 * rest of the service already treats an unknown aggregate function.
 */

const FLUX_DURATION = /^-?\d+(ns|us|µs|ms|s|m|h|d|w|mo|y)$/;

// A window may only be a whole number of seconds or more. Sub-second units are
// refused along with zero and negative ones: a millisecond window over a month
// is a denial of service against InfluxDB, not a chart anybody can read.
const FLUX_WINDOW = /^[1-9]\d*(s|m|h|d|w|mo|y)$/;

/** `0s` as a bound means now - Flux reads a relative duration against query time. */
export const NOW = '0s';
export const DEFAULT_WINDOW = '5m';
export const DEFAULT_RANGE_START = '-24h';

/** Rows one query may return. Placed before `yield()` so it actually bounds the response. */
export const ROW_LIMIT = 50000;

/**
 * `range(start:)` and `range(stop:)` take either a duration relative to now
 * (`-24h`, what the charts send) or an absolute instant (what a saved view and
 * the alarm evaluator send). Both are recognised; anything else falls back.
 */
export const fluxTimeBound = (value: unknown, fallback: string) => {
  const text = String(value ?? '');
  // The webapp's default `to` is the literal string `now()`. It is spelled out
  // rather than left to the fallback so a reader can see it is expected.
  if (text === 'now()' || FLUX_DURATION.test(text)) {
    return fluxDuration(text === 'now()' ? NOW : text);
  }
  const parsed = Date.parse(text);
  return isNaN(parsed) ? fluxDuration(fallback) : fluxDateTime(new Date(parsed).toISOString());
};

/** The window `aggregateWindow` buckets into. */
export const fluxWindow = (value: unknown) => {
  const text = String(value ?? '');
  return fluxDuration(FLUX_WINDOW.test(text) ? text : DEFAULT_WINDOW);
};
