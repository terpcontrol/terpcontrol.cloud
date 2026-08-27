import { anonymous, createAccount, Session } from '../support/api';
import { resetMeasurements, seedMeasurements } from '../support/control';
import { DeviceCredentials, provisionDevice } from '../support/device';

let owner: Session;
let device: DeviceCredentials;

/** A fixed, minute-aligned window keeps window boundaries predictable. */
const WINDOW_MINUTES = 10;
const now = Date.now();
const alignedNow = Math.floor(now / 60_000) * 60_000;
const from = new Date(alignedNow - WINDOW_MINUTES * 60_000).toISOString();
const to = new Date(alignedNow).toISOString();
const minutesAgo = (minutes: number) => alignedNow - minutes * 60_000;

const series = (measure: string, query: Record<string, string> = {}) =>
  owner.client.get(`/data/series/${device.deviceId}/${measure}`).query({ from, to, interval: '1m', method: 'mean', ...query });

const definedValues = (body: Array<{ _time: string; _value: number | null }>) =>
  body.filter(point => point._value !== null && !Number.isNaN(point._value));

beforeAll(async () => {
  owner = await createAccount('data-owner');
  device = await provisionDevice(owner);
});

beforeEach(async () => {
  await resetMeasurements();
});

describe('GET /data/series/:device_id/:measure', () => {
  it('returns one aggregated point per interval, empty windows included', async () => {
    await seedMeasurements([
      { time: minutesAgo(9) + 30_000, device_id: device.deviceId, fields: { temperature: 20 } },
      { time: minutesAgo(9) + 40_000, device_id: device.deviceId, fields: { temperature: 22 } },
      { time: minutesAgo(4) + 30_000, device_id: device.deviceId, fields: { temperature: 25 } },
    ]);

    const response = await series('temperature').expect(201);

    expect(response.body.length).toBe(WINDOW_MINUTES);
    // Empty windows are kept, with a null value, so a chart shows the gap.
    expect(response.body[0]).toEqual({ _time: expect.any(String), _value: null });

    const values = definedValues(response.body);
    expect(values.map((point: { _value: number }) => point._value)).toEqual([21, 25]);
  });

  it('honours the aggregation method', async () => {
    await seedMeasurements([
      { time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 10 } },
      { time: minutesAgo(5) + 20_000, device_id: device.deviceId, fields: { temperature: 30 } },
    ]);

    const min = await series('temperature', { method: 'min' }).expect(201);
    const max = await series('temperature', { method: 'max' }).expect(201);
    const sum = await series('temperature', { method: 'sum' }).expect(201);

    expect(definedValues(min.body)[0]._value).toBe(10);
    expect(definedValues(max.body)[0]._value).toBe(30);
    expect(definedValues(sum.body)[0]._value).toBe(40);
  });

  it('falls back to the mean for an unknown method', async () => {
    await seedMeasurements([
      { time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 10 } },
      { time: minutesAgo(5) + 20_000, device_id: device.deviceId, fields: { temperature: 30 } },
    ]);

    const response = await series('temperature', { method: 'median' }).expect(201);
    expect(definedValues(response.body)[0]._value).toBe(20);
  });

  it('never returns another device´s samples', async () => {
    const other = await provisionDevice(owner);
    await seedMeasurements([{ time: minutesAgo(5), device_id: other.deviceId, fields: { temperature: 99 } }]);

    const response = await series('temperature').expect(201);
    expect(definedValues(response.body)).toHaveLength(0);
  });

  it('derives vpd from temperature, humidity and the default day leaf offset', async () => {
    await seedMeasurements([
      { time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 25, humidity: 60, out_light: 1 } },
    ]);

    const response = await series('vpd').expect(201);

    // The light is on, so the default day offset of -2 K puts the leaf at 23 °C:
    // svp(23) - svp(25) * 0.6 = 2.809 - 1.900.
    expect(definedValues(response.body)[0]._value).toBeCloseTo(0.91, 2);
  });

  it('uses the night leaf offset while the light is off', async () => {
    await seedMeasurements([
      { time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 25, humidity: 60, out_light: 0 } },
    ]);

    const response = await series('vpd').expect(201);

    // The default night offset is 0 K, so the leaf sits at air temperature.
    expect(definedValues(response.body)[0]._value).toBeCloseTo(1.27, 2);
  });

  it('splits vpd into day and night by the light output', async () => {
    await seedMeasurements([
      { time: minutesAgo(6) + 10_000, device_id: device.deviceId, fields: { temperature: 25, humidity: 60, out_light: 1 } },
      { time: minutesAgo(3) + 10_000, device_id: device.deviceId, fields: { temperature: 25, humidity: 60, out_light: 0 } },
    ]);

    const day = await series('vpd_day').expect(201);
    const night = await series('vpd_night').expect(201);

    expect(definedValues(day.body)).toHaveLength(1);
    expect(definedValues(night.body)).toHaveLength(1);
    expect(definedValues(day.body)[0]._time).not.toBe(definedValues(night.body)[0]._time);
  });

  it('prefers a measured leaf temperature over the air temperature', async () => {
    await seedMeasurements([
      {
        time: minutesAgo(5) + 10_000,
        device_id: device.deviceId,
        fields: { temperature: 25, humidity: 60, out_light: 1, leaf_temperature: 22 },
      },
    ]);

    const response = await series('vpd').expect(201);
    // svp(22) - svp(25) * 0.6 = 2.6448 - 1.9014
    expect(definedValues(response.body)[0]._value).toBeCloseTo(0.74, 2);
  });

  it('derives ppfd from lux with the default calibration factor', async () => {
    await seedMeasurements([{ time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { lux: 20_000 } }]);

    const response = await series('ppfd').expect(201);
    expect(definedValues(response.body)[0]._value).toBeCloseTo(300, 5);
  });

  it('uses the device´s configured lux factor when one is set', async () => {
    const calibrated = await provisionDevice(owner);
    await owner.client
      .post('/device/cloudsettings')
      .send({ device_id: calibrated.deviceId, cloud_settings: { ppfdLuxFactor: 0.03, firmwareChannel: 'stable' } })
      .expect(200);

    await seedMeasurements([{ time: minutesAgo(5) + 10_000, device_id: calibrated.deviceId, fields: { lux: 20_000 } }]);

    const response = await owner.client
      .get(`/data/series/${calibrated.deviceId}/ppfd`)
      .query({ from, to, interval: '1m', method: 'mean' })
      .expect(201);

    expect(definedValues(response.body)[0]._value).toBeCloseTo(600, 5);
  });

  it('returns an empty series when nothing was recorded', async () => {
    const response = await series('co2').expect(201);
    expect(definedValues(response.body)).toHaveLength(0);
  });

  // The query is built by interpolation, so a parameter that closes it can
  // append a pipeline of its own - and the bucket holds every device there is.
  describe('the parameters that go into the query', () => {
    it('refuses a time range that carries more than a time', async () => {
      const stranger = await provisionDevice(await createAccount('data-injection-victim'));
      await seedMeasurements([{ time: minutesAgo(5) + 10_000, device_id: stranger.deviceId, fields: { temperature: 42 } }]);

      const injected = `now()) |> yield(name: "mine") from(bucket: "devices") |> range(start: -1h`;
      await series('temperature', { to: injected }).expect(400);
      await series('temperature', { from: injected }).expect(400);
    });

    it('refuses an interval and a measure that are not what they claim', async () => {
      await series('temperature', { interval: '1m, fn: mean, createEmpty: true) |> yield(name: "x"' }).expect(400);
      await series('temperature"] or r["_field"] == "humidity').expect(400);
    });

    it('still takes every shape the app asks for', async () => {
      await series('temperature', { from: '-30d', to: 'now()', interval: '5s' }).expect(201);
      await series('out_light', { from: '-1h30m', interval: '1w' }).expect(201);
    });

    it('reads the outputs whose names carry a hyphen', async () => {
      // `out_` plus the output name, and three of those are hyphenated.
      await seedMeasurements([
        { time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { 'out_fan-internal': 1 } },
        { time: Date.now() - 30_000, device_id: device.deviceId, fields: { 'out_fan-internal': 1 } },
      ]);

      const response = await series('out_fan-internal').expect(201);
      expect(definedValues(response.body)[0]._value).toBe(1);

      const latest = await owner.client.get(`/data/latest/${device.deviceId}/out_fan-internal`).expect(201);
      expect(latest.body.value).toBe(1);
    });
  });
});

describe('GET /data/latest/:device_id/:measure', () => {
  it('returns the most recent sample of the last five minutes', async () => {
    await seedMeasurements([
      { time: Date.now() - 240_000, device_id: device.deviceId, fields: { temperature: 18 } },
      { time: Date.now() - 30_000, device_id: device.deviceId, fields: { temperature: 24 } },
    ]);

    const response = await owner.client.get(`/data/latest/${device.deviceId}/temperature`).expect(201);
    expect(response.body.value).toBe(24);
  });

  it('ignores samples older than five minutes', async () => {
    await seedMeasurements([{ time: Date.now() - 600_000, device_id: device.deviceId, fields: { temperature: 18 } }]);

    const response = await owner.client.get(`/data/latest/${device.deviceId}/temperature`).expect(201);
    expect(response.body.value).toBeNull();
  });

  it('derives the latest vpd', async () => {
    await seedMeasurements([{ time: Date.now() - 30_000, device_id: device.deviceId, fields: { temperature: 25, humidity: 60, out_light: 1 } }]);

    const response = await owner.client.get(`/data/latest/${device.deviceId}/vpd`).expect(201);
    expect(response.body.value).toBeCloseTo(0.91, 2);
  });
});

describe('access control', () => {
  it('refuses a caller without a session', async () => {
    await anonymous().get(`/data/series/${device.deviceId}/temperature`).query({ from, to, interval: '1m' }).expect(401);
    await anonymous().get(`/data/latest/${device.deviceId}/temperature`).expect(401);
  });

  it('refuses a device the caller does not own', async () => {
    const stranger = await createAccount('data-stranger');
    await stranger.client.get(`/data/series/${device.deviceId}/temperature`).query({ from, to, interval: '1m' }).expect(403);
  });

  it('lets a share link read the series it grants', async () => {
    const share = await owner.client.post('/share').send({ device_id: device.deviceId, page: 'charts' }).expect(201);

    await seedMeasurements([{ time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 21 } }]);

    const response = await anonymous()
      .get(`/data/series/${device.deviceId}/temperature`)
      .query({ from, to, interval: '1m', share: share.body.share_id })
      .expect(201);

    expect(definedValues(response.body)[0]._value).toBe(21);
  });

  it('refuses a share link that points at another device', async () => {
    const otherDevice = await provisionDevice(owner);
    const share = await owner.client.post('/share').send({ device_id: otherDevice.deviceId, page: 'charts' }).expect(201);
    const stranger = await createAccount('data-share-stranger');

    // A signed-in caller gets 403, so a client can tell "log in again" apart
    // from "this session may not see this device".
    await stranger.client
      .get(`/data/series/${device.deviceId}/temperature`)
      .query({ from, to, interval: '1m', share: share.body.share_id })
      .expect(403);

    // Without a session at all the same request is a 401.
    await anonymous()
      .get(`/data/series/${device.deviceId}/temperature`)
      .query({ from, to, interval: '1m', share: share.body.share_id })
      .expect(401);
  });

  it('accepts a share token in the X-Share-Token header', async () => {
    const share = await owner.client.post('/share').send({ device_id: device.deviceId, page: 'charts' }).expect(201);
    await seedMeasurements([{ time: minutesAgo(5) + 10_000, device_id: device.deviceId, fields: { temperature: 19 } }]);

    const response = await anonymous()
      .get(`/data/series/${device.deviceId}/temperature`)
      .set('X-Share-Token', share.body.share_id)
      .query({ from, to, interval: '1m' })
      .expect(201);

    expect(definedValues(response.body)[0]._value).toBe(19);
  });
});
