import { createAccount, Session } from '../support/api';
import { seedMeasurements } from '../support/control';
import { provisionDevice } from '../support/device';

/**
 * The tent page over HTTP.
 *
 * What the unit suite cannot see is the measurement store: that one aggregation
 * over the last day really comes back through Flux, that a device reporting
 * every five minutes into two-minute windows is still read as one run rather
 * than as a run per sample, and that day and night are told apart by the light
 * the device wrote rather than by a clock.
 */

const MINUTES = 60_000;
const SAMPLE_MINUTES = 5;

let owner: Session;
let stranger: Session;

interface Seed {
  time: number;
  device_id: string;
  fields: Record<string, number>;
}

/**
 * A day: twelve hours lit and twelve dark, holding the target of whichever half
 * it is in - with one hour of the night an hour too warm, and the dehumidifier
 * on for two stretches of it.
 */
const aDay = (deviceId: string, now: number): Seed[] => {
  const seeds: Seed[] = [];

  for (let ago = 24 * 60; ago >= 0; ago -= SAMPLE_MINUTES) {
    const lit = ago > 12 * 60;
    const tooWarm = ago > 3 * 60 && ago <= 4 * 60;
    const drying = (ago > 8 * 60 && ago <= 9 * 60) || (ago > 2 * 60 && ago <= 3 * 60);

    seeds.push({
      time: now - ago * MINUTES,
      device_id: deviceId,
      fields: {
        temperature: lit ? 25 : tooWarm ? 24 : 20,
        humidity: 57,
        out_light: lit ? 1 : 0,
        out_dehumidifier: drying ? 1 : 0,
      },
    });
  }

  return seeds;
};

beforeAll(async () => {
  owner = await createAccount('overview-owner');
  stranger = await createAccount('overview-stranger');
});

it('answers one aggregation of the last day as a verdict on it', async () => {
  const device = await provisionDevice(owner, 'controller');
  await owner.client
    .put(`/v1/devices/${device.deviceId}/configuration`)
    .send({ configuration: { day: { temperature: 25, humidity: 55 }, night: { temperature: 20, humidity: 60 }, co2: { target: 1000 } } })
    .expect(200);

  const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
  await seedMeasurements(aDay(device.deviceId, Date.now()));

  const page = (await owner.client.get(`/v1/spaces/${spaceId}/overview`).expect(200)).body;

  expect(page).toMatchObject({ spaceId, deviceIds: [device.deviceId], grows: [], cameras: [], dueTasks: [] });
  // Each target carries the band around it, so the figure beside a value and the
  // verdict's "in band" are one judgement and no client keeps a width of its own.
  expect(page.targets).toEqual({
    day: [
      { metric: 'temperature', value: 25, band: 1 },
      { metric: 'humidity', value: 55, band: 5 },
      { metric: 'co2', value: 1000, band: 200 },
    ],
    night: [
      { metric: 'temperature', value: 20, band: 1 },
      { metric: 'humidity', value: 60, band: 5 },
      { metric: 'co2', value: 1000, band: 200 },
    ],
  });

  const verdict = page.verdict;
  expect(verdict).toMatchObject({ deviceId: device.deviceId, forSeconds: 86_400, rating: 'good' });
  expect(verdict.inBandFraction).toBeGreaterThan(0.9);

  // Twelve hours held against the day's band and twelve against the night's,
  // which is only right if the light said which was which: the same 25 °C is in
  // band while the lamp is on and three degrees over it once it is off.
  const temperature = verdict.metrics.find((row: { metric: string }) => row.metric === 'temperature');
  expect(temperature).toMatchObject({ dayBand: { low: 24, high: 26 }, nightBand: { low: 19, high: 21 }, minValue: 20, maxValue: 25 });
  expect(temperature.excursions).toEqual([expect.objectContaining({ above: true, extremeValue: 24 })]);

  // One hour, read through a device that filled one window in three: a run per
  // sample would be twelve excursions instead of one.
  const excursion = temperature.excursions[0];
  expect(Date.parse(excursion.endedAt) - Date.parse(excursion.startedAt)).toBeGreaterThan(50 * MINUTES);

  expect(verdict.actuators).toContainEqual({ output: 'dehumidifier', runCount: 2, forSeconds: expect.any(Number) });
  expect(verdict.actuators.find((row: { output: string }) => row.output === 'light')).toMatchObject({ runCount: 1 });

  // A metric the tent is steered on but the device never reported has its band
  // and no verdict, rather than a verdict drawn from nothing.
  expect(verdict.metrics.find((row: { metric: string }) => row.metric === 'co2')).toMatchObject({
    rating: null,
    dayBand: { low: 800, high: 1200 },
    nightBand: null,
    minValue: null,
  });

  expect(verdict.trend).toMatchObject({ metric: 'temperature' });
});

it('is not there at all for somebody with nothing to do with the tent', async () => {
  const device = await provisionDevice(owner, 'controller');
  const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;

  const refused = await stranger.client.get(`/v1/spaces/${spaceId}/overview`).expect(404);
  expect(refused.body.code).toBe('space_not_found');
});
