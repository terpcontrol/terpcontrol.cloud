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

/**
 * "My grows" over HTTP: the route the page reads, made of what the account
 * wrote through the grow routes - a grow that is running and one that was
 * harvested, which is the one way a grow leaves the home for good.
 */
it('lists every grow of the account, the running one first and the harvested one after it with what came down', async () => {
  const grower = await createAccount('home-grows');
  const start = (name: string, startedAt: string) =>
    grower.client
      .post('/v1/grows')
      .send({ name, type: 'photoperiod', plants: [{ strain: 'Gelato', count: 2 }], startedAt })
      .expect(201);

  const done = (await start('Spring', new Date(Date.now() - 120 * 86_400_000).toISOString())).body;
  await grower.client
    .post(`/v1/grows/${done.id}/harvests`)
    .send({ harvestedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), wetWeightG: 900, dryWeightG: 210 })
    .expect(201);
  const running = (await start('Autumn', new Date(Date.now() - 10 * 86_400_000).toISOString())).body;

  const page = (await grower.client.get('/v1/home/grows').expect(200)).body;

  expect(page.nextCursor).toBeNull();
  expect(page.items.map((card: { growId: string }) => card.growId)).toEqual([running.id, done.id]);
  expect(page.items[0]).toMatchObject({ endedAt: null, harvest: null, owner: null, places: [{ spaceId: null, name: null }] });
  expect(page.items[1]).toMatchObject({
    name: 'Spring',
    strains: [{ strain: 'Gelato', count: 2 }],
    harvest: { wetWeightG: 900, dryWeightG: 210 },
    coverMediaId: null,
  });
  expect(page.items[1].endedAt).toEqual(expect.any(String));

  const first = (await grower.client.get('/v1/home/grows').query({ limit: 1 }).expect(200)).body;
  const second = (await grower.client.get('/v1/home/grows').query({ limit: 1, cursor: first.nextCursor }).expect(200)).body;
  expect([...first.items, ...second.items].map((card: { growId: string }) => card.growId)).toEqual([running.id, done.id]);
});
