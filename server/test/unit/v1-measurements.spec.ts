import {
  computedValue,
  coveredGrains,
  deficitGrainFor,
  extremesByField,
  extremesQuery,
  fieldsFor,
  FluxRow,
  grainsQuery,
  gridOf,
  latestByField,
  levelsByField,
  levelsQuery,
  liveQuery,
  OutputSwitching,
  readingsOf,
  runningSpansOf,
  samplesQuery,
  seriesQuery,
  stepFor,
  switchingGrainFor,
  switchingsQuery,
  workedOutBy,
} from '@modules/data/flux';
import { DataService } from '@modules/data/data.service';
import { DEFAULT_DEVICE_SETTINGS } from '@database/schemas/v1/devices.schema';

/**
 * What goes to InfluxDB and what is made of what comes back. The store itself
 * needs a database; the query it sends and the arithmetic it does with the rows
 * do not, and those are where the decisions are.
 */

const BUCKET = 'measurements';
const DEVICE = 'sim-controller-1234';

const FACTORS = DEFAULT_DEVICE_SETTINGS;

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

describe('the grain the switchings are read at', () => {
  it('is the step of a window read finely, and never coarser than five minutes nor finer than a device reports', () => {
    expect([5, 60, 180, 300, 5400, undefined].map(switchingGrainFor)).toEqual([5, 60, 180, 300, 300, 300]);
    expect(switchingGrainFor(1)).toBe(5);
    expect(switchingsQuery(BUCKET, DEVICE, ['out_heater'], window(20, 0), switchingGrainFor(5))).toContain('aggregateWindow(every: 5s, fn: max');
    expect(switchingsQuery(BUCKET, DEVICE, ['out_heater'], window(20, 0))).toContain('aggregateWindow(every: 300s, fn: max');
  });
});

describe('the extremes of a window', () => {
  it('reads each window´s lowest and highest in one script, without creating the empty ones', () => {
    const query = extremesQuery(BUCKET, DEVICE, ['temperature', 'humidity'], window(60 * 24, 180));

    expect(query).toContain('aggregateWindow(every: 180s, fn: min, createEmpty: false)');
    expect(query).toContain('aggregateWindow(every: 180s, fn: max, createEmpty: false)');
    expect(query).toContain('yield(name: "min")');
    expect(query).toContain('yield(name: "max")');
  });

  it('gathers them by field and window, and leaves out a window a sentinel stands in', () => {
    const at = '2026-06-10T12:00:00.000Z';
    const rows = [
      { result: 'min', _field: 'humidity', _time: at, _value: 54.9 },
      { result: 'max', _field: 'humidity', _time: at, _value: 71.5 },
      // Points once tagged with an owner answer a second table: the lower low stands.
      { result: 'min', _field: 'humidity', _time: at, _value: 53.2 },
      // "No sensor" is not a reading, so that window has no lowest.
      { result: 'min', _field: 'co2', _time: at, _value: 0 },
      { result: 'max', _field: 'co2', _time: at, _value: 640 },
    ];

    expect(extremesByField(rows).get('humidity')?.get(at)).toEqual({ min: 53.2, max: 71.5 });
    expect(extremesByField(rows).get('co2')?.get(at)).toBeUndefined();
  });

  it('reads every raw sample of the fields a deficit is worked out from, and nothing else of them', () => {
    const query = samplesQuery(BUCKET, DEVICE, ['temperature', 'humidity'], window(60 * 24, 180));

    expect(query).toContain('r["_field"] == "temperature" or r["_field"] == "humidity"');
    expect(query).toContain('keep(columns: ["_time", "_value", "_field"])');
    expect(query).not.toContain('aggregateWindow');
  });

  it('tells the mean, the lowest and the highest of what each reading comes to, by the window the other means are stamped with', () => {
    const asked = { startsAt: new Date('2026-08-11T10:00:40Z'), endsAt: new Date('2026-08-11T10:07:10Z'), stepSeconds: 180 };
    const sample = (time: string, temperature: number, humidity: number) => [
      { _time: time, _field: 'temperature', _value: temperature },
      { _time: time, _field: 'humidity', _value: humidity },
    ];
    const rows = [
      ...sample('2026-08-11T10:00:42Z', 21, 55),
      // Cold and damp together, then warm and dry together: the coldest sample is never the driest.
      ...sample('2026-08-11T10:02:57Z', 19.4, 71.5),
      // On the grid, a sample opens the window after it, as `aggregateWindow` has it.
      ...sample('2026-08-11T10:03:00Z', 23, 50),
      ...sample('2026-08-11T10:05:59Z', 21, 55),
      // The last window is cut to the range and stamped with its end.
      ...sample('2026-08-11T10:07:02Z', 21, 55),
      // Half a sample is no deficit.
      { _time: '2026-08-11T10:07:07Z', _field: 'temperature', _value: 30 },
    ];
    const factors = { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 };
    const vpd = (temperature: number, humidity: number) =>
      computedValue(
        'vpd',
        readingsOf(field => ({ temperature, humidity })[field] ?? null),
        factors,
      );
    const extremes = workedOutBy(rows, asked, at => computedValue('vpd', readingsOf(at), factors));

    expect([...extremes.keys()].map(time => new Date(time).toISOString())).toEqual([
      '2026-08-11T10:03:00.000Z',
      '2026-08-11T10:06:00.000Z',
      '2026-08-11T10:07:10.000Z',
    ]);
    const [low, mid, high] = [vpd(19.4, 71.5) as number, vpd(21, 55) as number, vpd(23, 50) as number];
    expect(extremes.get(Date.parse('2026-08-11T10:03:00Z'))).toEqual({ mean: (mid + low) / 2, min: low, max: mid });
    expect(extremes.get(Date.parse('2026-08-11T10:06:00Z'))).toEqual({ mean: (high + mid) / 2, min: mid, max: high });
    expect(extremes.get(Date.parse('2026-08-11T10:07:10Z'))).toEqual({ mean: mid, min: mid, max: mid });
  });

  it('uses a grain`s leaf temperature only where leaf readings cover the grain as the air`s do', () => {
    const query = grainsQuery(BUCKET, DEVICE, ['temperature', 'humidity', 'leaf_temperature'], window(60 * 24 * 30, 5400), 300, [
      'leaf_temperature',
      'temperature',
    ]);
    expect(query).toContain('fn: count, createEmpty: false');
    expect(query).toContain('yield(name: "mean")');
    expect(query).toContain('yield(name: "count")');

    const grain = (time: string, leafReadings: number) => [
      { result: 'mean', _time: time, _field: 'temperature', _value: 25 },
      { result: 'mean', _time: time, _field: 'leaf_temperature', _value: 21 },
      { result: 'count', _time: time, _field: 'temperature', _value: 60 },
      ...(leafReadings > 0 ? [{ result: 'count', _time: time, _field: 'leaf_temperature', _value: leafReadings }] : []),
    ];
    const kept = coveredGrains(
      [...grain('2026-08-11T10:05:00Z', 60), ...grain('2026-08-11T10:10:00Z', 30), ...grain('2026-08-11T10:15:00Z', 1)],
      'leaf_temperature',
      'temperature',
    );

    // Sixty of sixty and thirty of sixty cover their grain; one stray reading in five minutes bends nothing.
    expect(kept.filter(row => row._field === 'leaf_temperature').map(row => row._time)).toEqual(['2026-08-11T10:05:00Z', '2026-08-11T10:10:00Z']);
    expect(kept.filter(row => row._field === 'temperature')).toHaveLength(3);
    expect(kept.every(row => (row as { result?: string }).result === 'mean')).toBe(true);
  });

  it('reads means over a grain where a window is too wide for its samples, and takes each grain at its own time', () => {
    const query = grainsQuery(BUCKET, DEVICE, ['temperature', 'humidity'], window(60 * 24 * 30, 5400), 300);
    expect(query).toContain('aggregateWindow(every: 300s, fn: mean, createEmpty: false)');
    expect(query).toContain('keep(columns: ["_time", "_value", "_field"])');

    // Five minutes up to a four-month grow; beyond, as many whole five minutes as keep the read within its limit.
    const days = (count: number) => ({ startsAt: new Date(0), endsAt: new Date(count * 86_400_000) });
    expect([30, 120, 200, 365].map(count => deficitGrainFor(days(count)))).toEqual([300, 300, 600, 900]);

    // A grain is stamped at its end: the one stamped 10:05 is of 10:00 to 10:05 and belongs to the window that ends at 10:05.
    const asked = { startsAt: new Date('2026-08-11T10:00:00Z'), endsAt: new Date('2026-08-11T10:10:00Z'), stepSeconds: 300 };
    const grains = ['2026-08-11T10:05:00Z', '2026-08-11T10:10:00Z'].map(time => ({ _time: time, _field: 'temperature', _value: 20 }));
    const times: number[] = [];
    const worked = workedOutBy(grains, asked, (at, time) => (times.push(time), at('temperature')), 300);

    expect([...worked.keys()].map(time => new Date(time).toISOString())).toEqual(['2026-08-11T10:05:00.000Z', '2026-08-11T10:10:00.000Z']);
    expect(times.map(time => new Date(time).toISOString())).toEqual(['2026-08-11T10:02:30.000Z', '2026-08-11T10:07:30.000Z']);
  });
});

describe('the levels query', () => {
  it('averages a level over the samples it was running in, and sums what the valve dosed', () => {
    const query = levelsQuery(BUCKET, DEVICE, ['out_light', 'out_fan-internal'], ['out_co2'], window(60 * 24, 87));
    const [level, dose] = query.split('yield(name: "level")');

    // A dark sample is not averaged in: the lane's spans say when, the level how hard.
    expect(level).toContain('r["_field"] == "out_light" or r["_field"] == "out_fan-internal"');
    expect(level).toContain('r._value > 0.0');
    expect(level).toContain('aggregateWindow(every: 87s, fn: mean, createEmpty: false)');
    // The valve's "there is none" is left out before it is summed, or a sum would swallow it.
    expect(dose).toContain('r["_field"] == "out_co2"');
    expect(dose).toContain('r["_value"] >= 0.0 and r["_value"] != 4294967295.0');
    expect(dose).toContain('aggregateWindow(every: 87s, fn: sum, createEmpty: false)');
    expect(dose).toContain('yield(name: "dose")');
  });

  it('asks only for what has a level, and refuses anything that is not a name', () => {
    expect(levelsQuery(BUCKET, DEVICE, ['out_light'], [], window(60, 60))).not.toContain('dose');
    expect(levelsQuery(BUCKET, DEVICE, [], ['out_co2'], window(60, 60))).not.toContain('"level"');
    expect(() => levelsQuery(BUCKET, DEVICE, ['x" or r["device_id"] == "other'], [], window(60, 60))).toThrow();
  });

  it('reads the rows back per field in order, adding up a dose answered twice and keeping the higher level', () => {
    const rows = [
      { result: 'level', _field: 'out_light', _time: '2026-01-20T10:10:00Z', _value: 80 },
      { result: 'level', _field: 'out_light', _time: '2026-01-20T10:05:00Z', _value: 40 },
      { result: 'level', _field: 'out_light', _time: '2026-01-20T10:10:00Z', _value: 60 },
      { result: 'dose', _field: 'out_co2', _time: '2026-01-20T10:05:00Z', _value: 2000 },
      { result: 'dose', _field: 'out_co2', _time: '2026-01-20T10:05:00Z', _value: 1500 },
      { result: 'dose', _field: 'out_co2', _time: '2026-01-20T10:10:00Z', _value: null },
    ];

    expect(levelsByField(rows)).toEqual(
      new Map([
        [
          'out_light',
          [
            { measuredAt: '2026-01-20T10:05:00Z', value: 40 },
            { measuredAt: '2026-01-20T10:10:00Z', value: 80 },
          ],
        ],
        ['out_co2', [{ measuredAt: '2026-01-20T10:05:00Z', value: 3500 }]],
      ]),
    );
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
    expect(stepFor(...rangeOf(60 * 24 * 30), 60)).toBe(519);
  });

  it('draws a day at twenty seconds where that is asked for, and nothing finer than a device reports', () => {
    expect(stepFor(...rangeOf(60 * 24), 20)).toBe(20);
    expect(stepFor(...rangeOf(20), 1)).toBe(5);
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
});

/**
 * VPD over a window, through the service that reads it.
 *
 * The store is stood in for. What is checked is that a deficit is never
 * worked out from the means of the window drawn: each reading by itself - a
 * sample inside three days, the mean of five minutes beyond - judged day or
 * night by its own lamp level, and the point their mean.
 */
describe('the deficit of a window', () => {
  const DEVICE = 'device-1';
  const MINUTE = 60_000;
  const startsAt = new Date('2026-01-20T10:00:00.000Z');
  const NIGHT = 1.27;
  const DAY = 0.91;

  /** One reading a minute for an hour of the same air; the lamp comes on at 10:57. */
  const LIT_FROM = Date.parse('2026-01-20T10:57:00.000Z');
  const readings = (everyMs: number, untilMs: number, light = (time: number) => (time >= LIT_FROM ? 100 : 0), from = startsAt.getTime()): FluxRow[] =>
    Array.from({ length: Math.floor(untilMs / everyMs) }, (_, index) => from + index * everyMs + 2000).flatMap(time => [
      { _time: new Date(time).toISOString(), _field: 'temperature', _value: 25 },
      { _time: new Date(time).toISOString(), _field: 'humidity', _value: 60 },
      { _time: new Date(time).toISOString(), _field: 'out_light', _value: light(time) },
    ]);

  /**
   * The service with the store stood in for. `read` is private, which is as it
   * should be - what a query comes back as is the store's business - so the
   * stub is put in from outside the type rather than by widening it.
   */
  const reading = (rows: (query: string) => FluxRow[]): DataService & { asked: string[] } => {
    const devices = { findOne: () => ({ lean: () => Promise.resolve({ settings: FACTORS }) }) };
    const data = new DataService(
      devices as never,
      { url: 'http://influx.invalid', token: 'x', org: 'org', bucket: BUCKET } as never,
    ) as DataService & {
      asked: string[];
    };
    data.asked = [];
    (data as unknown as { read: (query: string) => Promise<FluxRow[]> }).read = query => {
      data.asked.push(query);
      return Promise.resolve(rows(query));
    };

    return data;
  };
  /** The windows drawn, as the store answers their means: the air, and a lamp level that is a duty cycle. */
  const means = (stamps: number[], light: number): FluxRow[] =>
    stamps.flatMap(stamp => [
      { _time: new Date(stamp).toISOString(), _field: 'temperature', _value: 25 },
      { _time: new Date(stamp).toISOString(), _field: 'humidity', _value: 60 },
      { _time: new Date(stamp).toISOString(), _field: 'out_light', _value: light },
    ]);
  const isRaw = (query: string) => !query.includes('aggregateWindow') && !query.includes('status_daily');

  it('is the mean of its samples` deficit inside three days, each by its own lamp level, with the lowest and highest of them', async () => {
    const endsAt = new Date(startsAt.getTime() + 60 * MINUTE);
    const stamps = [30, 60].map(minutes => startsAt.getTime() + minutes * MINUTE);
    const data = reading(query => (isRaw(query) ? readings(MINUTE, 60 * MINUTE) : query.includes('status_daily') ? [] : means(stamps, 5)));
    const answer = await data.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: 1800, extremes: true });
    const [dark, switched] = answer.metrics[0].points;

    // The first half hour is night throughout: one figure, and no extremes to tell from it.
    expect(dark).toEqual({ measuredAt: new Date(stamps[0]).toISOString(), value: NIGHT });
    // In the second the lamp came on for its last three minutes: 27 samples of night and 3 of day. The point is
    // their mean - inside its own lowest and highest, which the deficit of the window's mean air never was.
    expect(switched.value).toBeCloseTo((27 * NIGHT + 3 * DAY) / 30, 2);
    expect(switched).toMatchObject({ min: DAY, max: NIGHT });
    // No read of the lamp's switchings any more: a reading says its own half.
    expect(data.asked.some(query => query.includes('difference('))).toBe(false);
  });

  it('is worked out from means over five minutes beyond three days, each grain by its own time - not from the means of the windows drawn', async () => {
    const days = 4;
    // From noon, so the windows of six hours a chart of four days draws begin with it.
    const from = Date.parse('2026-01-20T12:00:00.000Z');
    const endsAt = new Date(from + days * 24 * 60 * MINUTE);
    const stamps = Array.from({ length: days * 4 }, (_, index) => from + (index + 1) * 360 * MINUTE);
    // The lamp burns the second half of each of them.
    const lit = (time: number) => (Math.floor((time - from) / (180 * MINUTE)) % 2 === 1 ? 100 : 0);
    const data = reading(query =>
      query.includes('every: 300s')
        ? readings(5 * MINUTE, days * 24 * 60 * MINUTE, lit, from).map(row => ({
            ...row,
            _time: new Date(Date.parse(row._time!) + 5 * MINUTE - 2000).toISOString(),
          }))
        : query.includes('status_daily') || isRaw(query)
          ? []
          : means(stamps, 50),
    );
    const answer = await data.series(DEVICE, { metrics: ['vpd'], startsAt: new Date(from), endsAt, stepSeconds: 21_600, extremes: true });

    // Half of every window is night and half is day: its point is the mean of the two, its ends are the two.
    // From the window's own means - 25 °C, 60 %, a lamp "at 50 %" - every point read as day, 0.91, with no night in it.
    expect(new Set(answer.metrics[0].points.map(point => point.value))).toEqual(new Set([Number(((NIGHT + DAY) / 2).toFixed(2))]));
    expect(answer.metrics[0].points[3]).toMatchObject({ min: DAY, max: NIGHT });
    expect(data.asked.filter(query => query.includes('every: 300s'))).toHaveLength(1);
    expect(data.asked.some(isRaw)).toBe(false);
  });

  it('says no lowest and highest to a read that asked for none, and still the same deficit', async () => {
    const endsAt = new Date(startsAt.getTime() + 60 * MINUTE);
    const stamps = [30, 60].map(minutes => startsAt.getTime() + minutes * MINUTE);
    const data = reading(query => (isRaw(query) ? readings(MINUTE, 60 * MINUTE) : query.includes('status_daily') ? [] : means(stamps, 5)));
    const answer = await data.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: 1800 });

    expect(answer.metrics[0].points.map(point => Object.keys(point))).toEqual([
      ['measuredAt', 'value'],
      ['measuredAt', 'value'],
    ]);
    expect(answer.metrics[0].points[1].value).toBeCloseTo((27 * NIGHT + 3 * DAY) / 30, 2);
  });

  it('uses a leaf temperature in a live reading only where that reading carries one', async () => {
    const at = '2026-01-20T12:00:00.000Z';
    const live = (leafAt: string) =>
      reading(() => [
        { _time: at, _field: 'temperature', _value: 25 },
        { _time: at, _field: 'humidity', _value: 60 },
        { _time: at, _field: 'out_light', _value: 0 },
        { _time: leafAt, _field: 'leaf_temperature', _value: 21 },
      ]).live(DEVICE);

    // The leaf sensor wrote with this reading: its temperature is the leaf's.
    expect((await live(at)).metrics.vpd?.value).toBeCloseTo(0.59, 2);
    // It last wrote ten seconds - or ten days - before: the newest of its field still, and no part of this reading.
    expect((await live('2026-01-20T11:59:50.000Z')).metrics.vpd?.value).toBe(NIGHT);
    expect((await live('2026-01-10T12:00:00.000Z')).metrics.vpd?.value).toBe(NIGHT);
    // What the sensor last read is still answered as its own figure, with its own age.
    expect((await live('2026-01-10T12:00:00.000Z')).metrics.leafTemperature?.value).toBe(21);
  });

  it('has the mean of a day to go by where the store kept nothing else of it', async () => {
    const endsAt = new Date(startsAt.getTime() + 60 * MINUTE);
    const stamps = [30, 60].map(minutes => startsAt.getTime() + minutes * MINUTE);
    // No raw reading is left: the window's own means, the lamp's among them, are all there is.
    const kept = reading(query => (isRaw(query) || query.includes('status_daily') ? [] : means(stamps, 100)));
    const answer = await kept.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: 1800 });

    expect(answer.metrics[0].points.map(point => point.value)).toEqual([DAY, DAY]);
  });
});
