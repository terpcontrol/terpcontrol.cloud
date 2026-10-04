import { createAccount, Session } from '../support/api';
import { seedMeasurements } from '../support/control';
import { provisionDevice } from '../support/device';

/**
 * What the CO2 cylinders of a place lasted. A refill is a diary line carrying
 * the weight of the new cylinder and, where somebody weighed it, what was left
 * in the old one; the openings are what the valve of the device standing there
 * counted in between, one sample at a time.
 */

let owner: Session;
let stranger: Session;

const DAY = 24 * 3_600_000;

beforeAll(async () => {
  owner = await createAccount('co2-report-owner');
  stranger = await createAccount('co2-report-stranger');
});

const refill = (spaceId: string, occurredAt: number, readings: { key: string; value: number }[]) =>
  owner.client
    .post('/v1/entries')
    .send({
      kind: 'measurement',
      spaceId,
      occurredAt: new Date(occurredAt).toISOString(),
      values: { kind: 'measurement', readings: readings.map(reading => ({ ...reading, plantId: null })) },
    })
    .expect(201);

it('says what each cylinder gave, at what rate, and what the one in use has left', async () => {
  const fridge = await provisionDevice(owner, 'fridge');
  const spaceId = (await owner.client.get(`/v1/devices/${fridge.deviceId}`).expect(200)).body.spaceId;
  const start = Date.now() - 30 * DAY;

  // The first cylinder held 500 g and came out with 100 g left after 2000
  // openings: 5 a gram. The second has seen 1000 openings so far.
  await refill(spaceId, start, [{ key: 'co2FillingInitial', value: 500 }]);
  await refill(spaceId, start + 20 * DAY, [
    { key: 'co2FillingInitial', value: 425 },
    { key: 'co2FillingRest', value: 100 },
  ]);
  await seedMeasurements([
    { time: start + DAY, device_id: fridge.deviceId, fields: { out_co2: 1200 } },
    { time: start + 10 * DAY, device_id: fridge.deviceId, fields: { out_co2: 800 } },
    { time: start + 21 * DAY, device_id: fridge.deviceId, fields: { out_co2: 1000 } },
  ]);

  const report = (await owner.client.get(`/v1/spaces/${spaceId}/co2-report`).expect(200)).body;

  expect(report.openingsPerGram).toBe(5);
  expect(report.restGrams).toBe(225);
  expect(report.cylinders).toEqual([
    { since: expect.any(String), until: null, filledGrams: 425, restGrams: null, openings: 1000, openingsPerGram: null },
    { since: expect.any(String), until: expect.any(String), filledGrams: 500, restGrams: 100, openings: 2000, openingsPerGram: 5 },
  ]);
});

it('answers nothing for a place where no refill was ever written down, and nothing to anybody who may not see it', async () => {
  const tent = await provisionDevice(owner, 'controller');
  const spaceId = (await owner.client.get(`/v1/devices/${tent.deviceId}`).expect(200)).body.spaceId;

  expect((await owner.client.get(`/v1/spaces/${spaceId}/co2-report`).expect(200)).body).toEqual({
    cylinders: [],
    openingsPerGram: null,
    restGrams: null,
  });
  await stranger.client.get(`/v1/spaces/${spaceId}/co2-report`).expect(404);
});
