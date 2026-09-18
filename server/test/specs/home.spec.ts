import { createAccount, Session } from '../support/api';
import { seedMeasurements } from '../support/control';
import { provisionDevice } from '../support/device';

/**
 * The home over HTTP: one card per place, each carrying what it draws. What the
 * unit suite cannot see is the measurement store: that a card's readings and
 * its day of temperature come back from it, for every device in one go, and
 * land on the card of the place the device stands in.
 */

let owner: Session;

beforeAll(async () => {
  owner = await createAccount('home-owner');
});

it('is one request: every card carries its readings and its day of temperature', async () => {
  const tent = await provisionDevice(owner, 'controller');
  const fridge = await provisionDevice(owner, 'fridge');
  await owner.client.post('/v1/spaces').send({ kind: 'balcony', name: 'The balcony' }).expect(201);

  const now = Date.now();
  await seedMeasurements([
    { time: now - 3 * 3_600_000, device_id: tent.deviceId, fields: { temperature: 24 } },
    { time: now - 60_000, device_id: tent.deviceId, fields: { temperature: 25.5, humidity: 55 } },
    { time: now - 60_000, device_id: fridge.deviceId, fields: { temperature: 18 } },
  ]);

  const cards = (await owner.client.get('/v1/home').expect(200)).body.spaces;
  const known = (card: { trend: { points: (number | null)[] } | null }) => card.trend?.points.filter(point => point !== null);

  const tentCard = cards.find((card: { deviceIds: string[] }) => card.deviceIds.includes(tent.deviceId));
  expect(tentCard.values).toContainEqual(expect.objectContaining({ metric: 'temperature', value: 25.5, state: 'live' }));
  expect(tentCard.trend).toMatchObject({ metric: 'temperature', stepSeconds: 1800 });
  expect(known(tentCard)).toEqual([24, 25.5]);

  const fridgeCard = cards.find((card: { deviceIds: string[] }) => card.deviceIds.includes(fridge.deviceId));
  expect(known(fridgeCard)).toEqual([18]);

  const balcony = cards.find((card: { name: string }) => card.name === 'The balcony');
  expect(balcony).toMatchObject({ deviceIds: [], values: [], trend: null, grow: null });
});
