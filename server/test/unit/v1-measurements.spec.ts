import {
  computedValue,
  DEFAULT_PPFD_LUX_FACTOR,
  DeviceFactors,
  fieldsFor,
  gridOf,
  latestByField,
  liveQuery,
  readingsOf,
  seriesQuery,
  stepFor,
} from '@modules/data/flux';

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
});
