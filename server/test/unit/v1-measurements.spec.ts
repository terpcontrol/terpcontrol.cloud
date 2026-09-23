import {
  computedValue,
  DEFAULT_PPFD_LUX_FACTOR,
  DeviceFactors,
  fieldsFor,
  FluxRow,
  gridOf,
  latestByField,
  liveQuery,
  OutputSwitching,
  readingsOf,
  runningMostOf,
  runningSpansOf,
  seriesQuery,
  stepFor,
  switchingsQuery,
} from '@modules/data/flux';
import { DataService } from '@modules/data/data.service';

/**
 * What goes to InfluxDB and what is made of what comes back. The store itself
 * needs a database; the query it sends and the arithmetic it does with the rows
 * do not, and those are where the decisions are.
 */

const BUCKET = 'measurements';
const DEVICE = 'sim-controller-1234';

const FACTORS: DeviceFactors = { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: DEFAULT_PPFD_LUX_FACTOR };

const window = (minutes: number, stepSeconds: number) => ({
  startsAt: new Date('2026-01-20T10:00:00.000Z'),
  endsAt: new Date(Date.parse('2026-01-20T10:00:00.000Z') + minutes * 60_000),
  stepSeconds,
});

const readings = (values: Record<string, number>) => readingsOf(field => values[field] ?? null);

describe('the live query', () => {
  it('asks for the newest point of every field of one device', () => {
    const query = liveQuery(BUCKET, DEVICE);

    expect(query).toContain('from(bucket: "measurements")');
    expect(query).toContain(`r["device_id"] == "${DEVICE}"`);
    expect(query).toContain('|> last()');
    // No field filter: a device costs one read however many values it reports.
    expect(query).not.toContain('_field');
  });
});

describe('the series query', () => {
  it('reads the fields of the metrics and outputs it was asked for', () => {
    const query = seriesQuery(BUCKET, DEVICE, fieldsFor(['temperature'], ['fanInternal']), window(60, 300));

    expect(query).toContain('r["_field"] == "temperature" or r["_field"] == "out_fan-internal"');
    expect(query).toContain('range(start: 2026-01-20T10:00:00.000Z, stop: 2026-01-20T11:00:00.000Z)');
    expect(query).toContain('aggregateWindow(every: 300s, fn: mean, createEmpty: true)');
  });

  it('refuses to interpolate anything that is not a name', () => {
    // The bucket holds every device of every customer, so a value that can close
    // the query can read all of it.
    const injected = `x" or r["device_id"] == "somebody-else`;

    expect(() => seriesQuery(BUCKET, injected, ['temperature'], window(60, 300))).toThrow();
    expect(() => seriesQuery(BUCKET, DEVICE, [injected], window(60, 300))).toThrow();
  });
});

describe('the switchings query', () => {
  it('excludes the "there is no valve" figure in the store', () => {
    // The store reduces each grain to a max and maps it to running or not, so
    // a sentinel left in would arrive as an ordinary lit bar with nothing left
    // to tell it from a valve that really ran. It has to go before the max.
    const query = switchingsQuery(BUCKET, DEVICE, fieldsFor([], ['co2', 'heater']), window(60, 0));
    const excluded = query.indexOf('out_co2" or');
    const reduced = query.indexOf('aggregateWindow');

    expect(query).toContain('r["_field"] != "out_co2" or (r["_value"] >= 0.0 and r["_value"] != 4294967295.0)');
    expect(excluded).toBeGreaterThan(-1);
    expect(excluded).toBeLessThan(reduced);
  });
});

describe('the fields a request has to read', () => {
  it('pulls in what a computed metric is built from', () => {
    expect(fieldsFor(['vpd'], [])).toEqual(['temperature', 'humidity', 'leaf_temperature', 'out_light']);
    expect(fieldsFor(['ppfd'], [])).toEqual(['lux']);
    // Derived from the device's own `lastSeenAt`, so it reads nothing at all.
    expect(fieldsFor(['offline'], [])).toEqual([]);
  });

  it('names each field once, however many metrics need it', () => {
    expect(fieldsFor(['temperature', 'vpd'], ['light'])).toEqual(['temperature', 'humidity', 'leaf_temperature', 'out_light']);
  });
});

describe('the step of a series', () => {
  it('picks one from the range when the caller names none', () => {
    expect(stepFor(...rangeOf(10), undefined)).toBe(5);
    expect(stepFor(...rangeOf(60 * 24 * 30), undefined)).toBe(2592);
  });

  it('widens a step that would build more points than a series may hold', () => {
    expect(stepFor(...rangeOf(60), 60)).toBe(60);
    expect(stepFor(...rangeOf(60 * 24 * 30), 60)).toBe(2592);
  });
});

const rangeOf = (minutes: number): [Date, Date] => [window(minutes, 0).startsAt, window(minutes, 0).endsAt];

describe('reading the rows back', () => {
  it('keeps the newest point of each field and drops what is not a number', () => {
    const latest = latestByField([
      { _field: 'temperature', _time: '2026-01-20T10:00:00Z', _value: 20 },
      { _field: 'temperature', _time: '2026-01-20T10:05:00Z', _value: 22 },
      { _field: 'humidity', _time: '2026-01-20T10:05:00Z', _value: null },
    ]);

    expect(latest.get('temperature')).toEqual({ value: 22, measuredAt: new Date('2026-01-20T10:05:00Z') });
    expect(latest.has('humidity')).toBe(false);
  });

  it('lays the windows out as a grid, so the fields of a computed metric line up', () => {
    const grid = gridOf([
      { _field: 'temperature', _time: '2026-01-20T10:05:00Z', _value: 25 },
      { _field: 'temperature', _time: '2026-01-20T10:00:00Z', _value: 24 },
      { _field: 'humidity', _time: '2026-01-20T10:05:00Z', _value: 60 },
    ]);

    expect(grid.instants).toEqual(['2026-01-20T10:00:00Z', '2026-01-20T10:05:00Z']);
    expect(grid.valuesByField.get('humidity')?.get('2026-01-20T10:00:00Z')).toBeUndefined();
    expect(grid.valuesByField.get('temperature')?.get('2026-01-20T10:00:00Z')).toBe(24);
  });

  it('passes over the CO2 a device writes to say it has no sensor', () => {
    // Years of these were stored before the ingest knew to drop them, and the
    // live read looks a month back - so the newest real reading is the answer,
    // and a device that has only ever written the sentinel answers nothing.
    const latest = latestByField([
      { _field: 'co2', _time: '2026-01-20T10:00:00Z', _value: 900 },
      { _field: 'co2', _time: '2026-01-20T10:05:00Z', _value: -1 },
      { _field: 'temperature', _time: '2026-01-20T10:05:00Z', _value: 22 },
    ]);

    expect(latest.get('co2')).toEqual({ value: 900, measuredAt: new Date('2026-01-20T10:00:00Z') });
    expect(latestByField([{ _field: 'co2', _time: '2026-01-20T10:05:00Z', _value: 0 }]).has('co2')).toBe(false);
  });

  it('leaves a window of that sentinel as the gap it is', () => {
    const grid = gridOf([
      { _field: 'co2', _time: '2026-01-20T10:00:00Z', _value: -1 },
      { _field: 'co2', _time: '2026-01-20T10:05:00Z', _value: 1200 },
    ]);

    // Still an instant in the grid, so a chart draws the hole rather than
    // joining across it - which is what a sensor that is not there leaves.
    expect(grid.instants).toEqual(['2026-01-20T10:00:00Z', '2026-01-20T10:05:00Z']);
    expect(grid.valuesByField.get('co2')?.get('2026-01-20T10:00:00Z')).toBeNull();
    expect(grid.valuesByField.get('co2')?.get('2026-01-20T10:05:00Z')).toBe(1200);
  });
});

describe('the metrics the cloud computes', () => {
  it('corrects vpd with the day offset while the light is on', () => {
    // svp(23) - svp(25) * 0.6 = 2.809 - 1.900
    expect(computedValue('vpd', readings({ temperature: 25, humidity: 60, out_light: 1 }), FACTORS)).toBeCloseTo(0.91, 2);
  });

  it('uses the night offset while the light is off', () => {
    // The default night offset is 0 K, so the leaf sits at air temperature.
    expect(computedValue('vpd', readings({ temperature: 25, humidity: 60, out_light: 0 }), FACTORS)).toBeCloseTo(1.27, 2);
  });

  it('prefers a measured leaf temperature over any offset', () => {
    // svp(22) - svp(25) * 0.6 = 2.6448 - 1.9014
    const withLeaf = readings({ temperature: 25, humidity: 60, out_light: 1, leaf_temperature: 22 });
    expect(computedValue('vpd', withLeaf, FACTORS)).toBeCloseTo(0.74, 2);
  });

  it('answers nothing where an input is missing', () => {
    expect(computedValue('vpd', readings({ temperature: 25 }), FACTORS)).toBeNull();
    expect(computedValue('ppfd', readings({}), FACTORS)).toBeNull();
  });

  it('turns lux into ppfd with the device´s own factor', () => {
    expect(computedValue('ppfd', readings({ lux: 20_000 }), FACTORS)).toBeCloseTo(300, 5);
    expect(computedValue('ppfd', readings({ lux: 20_000 }), { ...FACTORS, ppfdLuxFactor: 0.03 })).toBeCloseTo(600, 5);
  });

  it('takes the half of the cycle from the caller where the caller knows it', () => {
    // The same reading, computed both ways: the offset is the whole of the
    // difference, and it is a third of the figure.
    const lit = readingsOf(field => ({ temperature: 25, humidity: 60 })[field] ?? null, true);
    const dark = readingsOf(field => ({ temperature: 25, humidity: 60 })[field] ?? null, false);

    expect(computedValue('vpd', lit, FACTORS)).toBeCloseTo(0.91, 2);
    expect(computedValue('vpd', dark, FACTORS)).toBeCloseTo(1.27, 2);

    // A bucket 93 % of which was dark carries a mean `out_light` of a percent
    // or two, which the old rule read as "the lamp was on".
    expect(
      computedValue(
        'vpd',
        readingsOf(field => ({ temperature: 25, humidity: 60, out_light: 1.64 })[field] ?? null, false),
        FACTORS,
      ),
    ).toBeCloseTo(1.27, 2);
  });
});

describe('which half of the cycle a window was in', () => {
  const at = (minutes: number) => new Date(Date.parse('2026-01-20T10:00:00.000Z') + minutes * 60_000).toISOString();

  /** The window opens dark, the lamp comes on at 10:20 and is still on at the end. */
  const switchings: OutputSwitching[] = [
    { at: at(0), on: false },
    { at: at(20), on: true },
  ];

  it('reads the switchings as the stretches the lamp ran for, the last of them open-ended', () => {
    expect(runningSpansOf(switchings)).toEqual([{ from: Date.parse(at(20)), to: Number.POSITIVE_INFINITY }]);
    expect(runningSpansOf([{ at: at(0), on: false }])).toEqual([]);
  });

  it('calls a bucket lit only where the lamp ran for more than half of it', () => {
    const spans = runningSpansOf(switchings);

    // The bucket that ends at 10:29 is dark for two thirds of itself although
    // the lamp is on when it closes - which is the bucket the averaged field
    // used to call a day.
    expect(runningMostOf(spans, Date.parse(at(0)), Date.parse(at(29)))).toBe(false);
    expect(runningMostOf(spans, Date.parse(at(29)), Date.parse(at(58)))).toBe(true);
    expect(runningMostOf(spans, Date.parse(at(10)), Date.parse(at(30)))).toBe(false);
    expect(runningMostOf(spans, Date.parse(at(30)), Date.parse(at(30)))).toBe(false);
  });
});

/**
 * VPD over a window, through the service that reads it.
 *
 * The store is stood in for: what is worth checking is that the deficit of a
 * bucket follows the lamp's own switchings rather than what its `out_light`
 * averaged to, because those two disagree on every bucket a lamp switched
 * inside - and the shading the same answer carries is drawn from the
 * switchings.
 */
describe('the deficit of a window', () => {
  const DEVICE = 'device-1';
  const STEP_SECONDS = 1800;
  const startsAt = new Date('2026-01-20T10:00:00.000Z');
  const endsAt = new Date('2026-01-20T11:00:00.000Z');
  const buckets = [new Date('2026-01-20T10:30:00.000Z'), new Date('2026-01-20T11:00:00.000Z')];

  /** The lamp comes on three minutes before the end of the second bucket, and nothing else changes all hour. */
  const LIT_FROM = new Date('2026-01-20T10:57:00.000Z');

  const rowsFor = (query: string): FluxRow[] => {
    if (query.includes('difference(')) {
      return [
        { _time: startsAt.toISOString(), _field: 'out_light', _value: 0 },
        { _time: LIT_FROM.toISOString(), _field: 'out_light', _value: 1 },
      ];
    }
    if (query.includes('status_daily')) return [];

    return buckets.flatMap(bucket => [
      { _time: bucket.toISOString(), _field: 'temperature', _value: 25 },
      { _time: bucket.toISOString(), _field: 'humidity', _value: 60 },
      // The mean of a bucket the lamp ran three minutes of: enough to clear any
      // threshold on the field, nowhere near enough to be a day.
      { _time: bucket.toISOString(), _field: 'out_light', _value: bucket.getTime() === buckets[1].getTime() ? 1.64 : 0 },
    ]);
  };

  /**
   * The service with the store stood in for. `read` is private, which is as it
   * should be - what a query comes back as is the store's business - so the
   * stub is put in from outside the type rather than by widening it.
   */
  const reading = (rows: (query: string) => FluxRow[] = rowsFor): DataService => {
    const devices = { findOne: () => ({ lean: () => Promise.resolve({ settings: FACTORS }) }) };
    const data = new DataService(devices as never, { url: 'http://influx.invalid', token: 'x', org: 'org', bucket: BUCKET } as never);
    (data as unknown as { read: (query: string) => Promise<FluxRow[]> }).read = query => Promise.resolve(rows(query));

    return data;
  };

  it('computes each bucket against the half of the cycle the lamp says it was in', async () => {
    const answer = await reading().series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: STEP_SECONDS });

    // Both buckets are night: the lamp came on for the last three minutes of
    // the second, which is a duty cycle and not a day. Read off the averaged
    // field, the second answered 0.91 - a third low, under a night the same
    // answer shades.
    expect(answer.metrics[0].points.map(point => point.value)).toEqual([expect.closeTo(1.27, 2), expect.closeTo(1.27, 2)]);
  });

  it('reads a bucket the lamp ran through as a day', async () => {
    const lit = reading(query =>
      query.includes('difference(') ? [{ _time: startsAt.toISOString(), _field: 'out_light', _value: 1 }] : rowsFor(query),
    );

    const answer = await lit.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: STEP_SECONDS });

    expect(answer.metrics[0].points.map(point => point.value)).toEqual([expect.closeTo(0.91, 2), expect.closeTo(0.91, 2)]);
  });

  it('falls back to the averaged field where the store knows of no switching at all', async () => {
    // A day old enough to have been summarised away has no raw samples behind
    // it and therefore no switchings, and its own averaged light is then the
    // only thing left to read it by.
    const quiet = reading(query => (query.includes('difference(') ? [] : rowsFor(query)));

    const answer = await quiet.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: STEP_SECONDS });

    expect(answer.metrics[0].points.map(point => point.value)).toEqual([expect.closeTo(1.27, 2), expect.closeTo(0.91, 2)]);
  });
});
