import { createAccount, Session } from '../support/api';
import { seedMeasurements } from '../support/control';
import { provisionDevice } from '../support/device';

/**
 * The diary over HTTP: the timeline, the week cards and the report.
 *
 * The unit suite has the arithmetic and the access matrix against a database.
 * What it cannot see is the measurement store, so what is checked here is the
 * rest of the way: that a week's day and night averages really come back through
 * Flux and are told apart by the light the device wrote rather than by a clock,
 * that a chapter is judged against the targets the phase recorded, and that a
 * stranger is told the grow is not there.
 */

const MINUTES = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_MINUTES = 30;

const DAY_TEMPERATURE = 25;
const NIGHT_TEMPERATURE = 20;

let owner: Session;
let stranger: Session;
let growId: string;
let now: number;

interface Seed {
  time: number;
  device_id: string;
  fields: Record<string, number>;
}

/** A week on 12/12, sampled every half hour: twelve hours lit at the day target and twelve dark at the night one. */
const aWeek = (deviceId: string, until: number): Seed[] => {
  const seeds: Seed[] = [];

  for (let ago = 7 * 24 * 60; ago > 0; ago -= SAMPLE_MINUTES) {
    const lit = Math.floor(ago / 60) % 24 < 12;

    seeds.push({
      time: until - ago * MINUTES,
      device_id: deviceId,
      fields: { temperature: lit ? DAY_TEMPERATURE : NIGHT_TEMPERATURE, humidity: 55, out_light: lit ? 1 : 0 },
    });
  }

  return seeds;
};

/** A grow three weeks old that flipped to flower a week ago, in a tent whose controller has been keeping it. */
beforeAll(async () => {
  owner = await createAccount('diary-owner');
  stranger = await createAccount('diary-stranger');
  now = Date.now();

  const device = await provisionDevice(owner, 'controller');
  await owner.client
    .put(`/v1/devices/${device.deviceId}/configuration`)
    .send({ configuration: { day: { temperature: DAY_TEMPERATURE, humidity: 55 }, night: { temperature: NIGHT_TEMPERATURE, humidity: 55 } } })
    .expect(200);

  const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
  const startedAt = new Date(now - 20 * DAY_MS).toISOString();

  const grow = (
    await owner.client
      .post('/v1/grows')
      .send({ name: 'Diary run', type: 'photoperiod', spaceId, startedAt, plants: [{ strain: 'Amnesia', count: 2 }] })
      .expect(201)
  ).body;
  growId = grow.id;

  await owner.client.post(`/v1/grows/${growId}/phases`).send({ stage: 'vegetative', startedAt }).expect(201);
  await owner.client
    .post(`/v1/grows/${growId}/phases`)
    .send({ stage: 'flowering', startedAt: new Date(now - 6 * DAY_MS).toISOString() })
    .expect(201);

  await seedMeasurements(aWeek(device.deviceId, now));
});

describe('the week cards', () => {
  it('counts the grow´s own weeks and days, newest first', async () => {
    const page = (await owner.client.get(`/v1/grows/${growId}/weeks`).expect(200)).body;

    expect(page.items.map((week: { weekNumber: number }) => week.weekNumber)).toEqual([3, 2, 1]);
    expect(page.items[0]).toMatchObject({ weekNumber: 3, dayFrom: 15, dayTo: 21, stage: 'flowering', stageWeek: 1 });
    expect(page.items[0].days).toHaveLength(7);
  });

  it('tells the day and the night apart by the light the device wrote, through the store', async () => {
    const page = (await owner.client.get(`/v1/grows/${growId}/weeks?limit=1`).expect(200)).body;
    const temperature = page.items[0].climate.find((one: { metric: string }) => one.metric === 'temperature');

    expect(temperature).toMatchObject({ dayAverage: DAY_TEMPERATURE, nightAverage: NIGHT_TEMPERATURE });
    expect(page.items[0].lightHours).toBeCloseTo(12, 0);
  });

  it('pages, and names everyone its cards name', async () => {
    const first = (await owner.client.get(`/v1/grows/${growId}/weeks?limit=2`).expect(200)).body;
    const second = (await owner.client.get(`/v1/grows/${growId}/weeks?limit=2&cursor=${first.nextCursor}`).expect(200)).body;

    expect(first.items.map((week: { weekNumber: number }) => week.weekNumber)).toEqual([3, 2]);
    expect(second.items.map((week: { weekNumber: number }) => week.weekNumber)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
    expect(first.people).toEqual([{ id: owner.userId, handle: expect.any(String) }]);
  });

  it('is not there for a stranger', async () => {
    await stranger.client.get(`/v1/grows/${growId}/weeks`).expect(404);
  });
});

describe('the report', () => {
  it('is one chapter per phase, judged against the targets the phase recorded', async () => {
    const report = (await owner.client.get(`/v1/grows/${growId}/report`).expect(200)).body;

    expect(report).toMatchObject({ growId, name: 'Diary run', dayCount: 21, plantCount: 2, strains: ['Amnesia'] });
    expect(report.phases.map((chapter: { stage: string }) => chapter.stage)).toEqual(['flowering', 'vegetative']);
    expect(report.phases[0]).toMatchObject({ dayFrom: 15, dayTo: null, spaceIds: [expect.any(String)] });
    // Held at the target of whichever half of the cycle it was in, all week.
    expect(report.phases[0].inBandPercent).toBe(100);
  });

  it('is not there for a stranger', async () => {
    await stranger.client.get(`/v1/grows/${growId}/report`).expect(404);
  });
});

describe('the timeline', () => {
  it('answers the grow´s own lines, newest first', async () => {
    const page = (await owner.client.get(`/v1/entries?growId=${growId}`).expect(200)).body;

    expect(page.items.map((line: { kind: string; values: { stage: string } }) => [line.kind, line.values.stage])).toEqual([
      ['phase', 'flowering'],
      ['phase', 'vegetative'],
    ]);
    expect(page.items[0].authorId).toBe(owner.userId);
  });

  it('filters by kind, and refuses a kind that is not one', async () => {
    await owner.client.get(`/v1/entries?growId=${growId}&kinds=water`).expect(200);
    await owner.client.get(`/v1/entries?growId=${growId}&kinds=gardening`).expect(400);
  });

  it('is about exactly one thing', async () => {
    await owner.client.get('/v1/entries').expect(400);
  });

  it('is not there for a stranger', async () => {
    await stranger.client.get(`/v1/entries?growId=${growId}`).expect(404);
  });
});
