import { flux, fluxDateTime, fluxDuration, fluxExpression, fluxString } from '@influxdata/influxdb-client';
import { DEFAULT_RANGE_START, DEFAULT_WINDOW, fluxTimeBound, fluxWindow } from '@utils/flux';

/**
 * The queries in `data.service` are built from URL parameters. These tests hold
 * the contract those queries rest on: a hostile `measure` or `device_id` must
 * end up as a Flux *string*, never as Flux syntax, and a window must never be
 * small enough to turn a month of data into a denial of service.
 *
 * The service itself is not imported - loading it starts an MQTT client, which
 * no unit test should need. `@utils/flux` holds the conversions, and the
 * template tag is exercised in the same shape the service uses it.
 */
describe('flux parameter escaping', () => {
  const build = (measure: string, deviceId: string, start: string, window: string, method: string) =>
    String(flux`
      from(bucket: ${fluxString('devices')})
        |> range(start: ${fluxDuration(start)})
        |> filter(fn: (r) => r["_field"] == ${fluxString(measure)})
        |> filter(fn: (r) => r["device_id"] == ${fluxString(deviceId)})
        |> aggregateWindow(every: ${fluxDuration(window)}, fn: ${fluxExpression(method)}, createEmpty: true)
    `);

  it('escapes a measure that tries to close the string and add a filter', () => {
    const query = build('temperature" or true or r["_field"] == "humidity', 'dev-1', '-24h', '5m', 'mean');
    expect(query).toContain('r["_field"] == "temperature\\" or true or r[\\"_field\\"] == \\"humidity"');
    expect(query).not.toContain('"temperature" or true');
  });

  it('escapes a device id that tries to widen the query to every device', () => {
    const query = build('temperature', 'dev-1")\n  |> filter(fn: (r) => true', '-24h', '5m', 'mean');
    expect(query).toContain('r["device_id"] == "dev-1\\")\\n  |> filter(fn: (r) => true"');
    // The injected pipe stage never becomes one: it stays inside the quotes.
    expect(query.split('\n').some(line => line.trim() === '|> filter(fn: (r) => true')).toBe(false);
  });

  it('keeps a trailing backslash from escaping the closing quote', () => {
    expect(build('temp\\', 'dev-1', '-24h', '5m', 'mean')).toContain('== "temp\\\\"');
  });

  it('renders a duration as a duration, not as bare text', () => {
    expect(build('temperature', 'dev-1', '-24h', '5m', 'mean')).toContain('range(start: duration(v: "-24h"))');
  });

  it('passes the aggregate function through as syntax, which is why it is allowlisted', () => {
    expect(build('temperature', 'dev-1', '-24h', '5m', 'mean')).toContain('fn: mean,');
    // Nothing stops an unchecked one, which is the whole reason for the allowlist.
    expect(String(flux`fn: ${fluxExpression('mean) |> drop(fn: (column) => true')}`)).toContain('|> drop');
  });

  it('renders an absolute bound as a Flux time value', () => {
    expect(String(fluxDateTime('2026-08-25T10:00:00.000Z'))).toBe('time(v: "2026-08-25T10:00:00.000Z")');
  });

  describe('fluxWindow', () => {
    it('keeps a window the charts actually send', () => {
      ['1s', '5s', '5m', '1h', '1d', '1w', '1mo', '1y'].forEach(w => {
        expect(String(fluxWindow(w))).toBe(`duration(v: "${w}")`);
      });
    });

    it('refuses sub-second units, so a month cannot be asked for in milliseconds', () => {
      ['1ms', '500us', '1ns'].forEach(w => {
        expect(String(fluxWindow(w))).toBe(`duration(v: "${DEFAULT_WINDOW}")`);
      });
    });

    it('refuses zero, negative, missing and non-durations', () => {
      ['0s', '0m', '-5m', '', 'abc', '5m) |> drop()'].forEach(w => {
        expect(String(fluxWindow(w))).toBe(`duration(v: "${DEFAULT_WINDOW}")`);
      });
      expect(String(fluxWindow(undefined))).toBe(`duration(v: "${DEFAULT_WINDOW}")`);
      expect(String(fluxWindow(null))).toBe(`duration(v: "${DEFAULT_WINDOW}")`);
    });
  });

  describe('fluxTimeBound', () => {
    it('takes a relative duration as one', () => {
      expect(String(fluxTimeBound('-7d', DEFAULT_RANGE_START))).toBe('duration(v: "-7d")');
    });

    it('takes an absolute instant as a time', () => {
      expect(String(fluxTimeBound('2026-08-25T10:00:00Z', DEFAULT_RANGE_START))).toBe('time(v: "2026-08-25T10:00:00.000Z")');
    });

    it("reads the webapp's literal now() as now", () => {
      expect(String(fluxTimeBound('now()', DEFAULT_RANGE_START))).toBe('duration(v: "0s")');
    });

    it('falls back rather than passing anything else on', () => {
      ['', '-24h) |> yield()', 'tomorrow', 'now', 'now()) |> drop()'].forEach(v => {
        expect(String(fluxTimeBound(v, DEFAULT_RANGE_START))).toBe(`duration(v: "${DEFAULT_RANGE_START}")`);
      });
      expect(String(fluxTimeBound(undefined, DEFAULT_RANGE_START))).toBe(`duration(v: "${DEFAULT_RANGE_START}")`);
    });
  });
});
