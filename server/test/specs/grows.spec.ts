import { createAccount, Session } from '../support/api';
import { claimCodeOf, registerDevice } from '../support/device';

/**
 * A grow over HTTP: the new-grow sheet, the phase it enters, and the move that
 * sends half of it to the fridge.
 *
 * The unit suite has the arithmetic and the access matrix against a database;
 * what is checked here is the rest of the way - that the bodies the contract
 * describes are the bodies the routes take, that the derived facts ride on the
 * answers rather than being left to a client, and that a stranger is told the
 * grow is not there.
 */

let owner: Session;
let stranger: Session;
let tent: string;

/** A tent with a controller in it, which is what a claim leaves behind. */
const tentWithAController = async (): Promise<string> => {
  const device = await registerDevice('controller');
  const claimed = await owner.client
    .post('/v1/devices/claims')
    .send({ code: await claimCodeOf(device.deviceId) })
    .expect(201);

  return claimed.body.device.spaceId as string;
};

const startAGrow = async (over: Record<string, unknown> = {}) => {
  const created = await owner.client
    .post('/v1/grows')
    .send({
      name: 'Spring run',
      type: 'photoperiod',
      plants: [
        { strain: 'Amnesia', count: 2 },
        { strain: 'Gelato', count: 1 },
      ],
      spaceId: tent,
      ...over,
    })
    .expect(201);

  return created.body;
};

beforeAll(async () => {
  owner = await createAccount('grows-owner');
  stranger = await createAccount('grows-stranger');
  tent = await tentWithAController();
});

describe('the new-grow sheet', () => {
  it('makes a plant per plant and stands them where the sheet said', async () => {
    const grow = await startAGrow();

    expect(grow).toMatchObject({ ownerId: owner.userId, type: 'photoperiod', visibility: 'private' });
    expect(grow.slug).toEqual(expect.any(String));
    expect(grow.placements).toHaveLength(1);
    expect(grow.placements[0]).toMatchObject({ spaceId: tent, endedAt: null });

    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    expect(plants.body.items.map((plant: { label: string }) => plant.label)).toEqual(['Amnesia 1', 'Amnesia 2', 'Gelato 1']);
  });

  it('counts no day until the grow has entered a phase', async () => {
    const grow = await startAGrow();

    expect(grow.summary).toMatchObject({ dayNumber: null, stage: null, isAuto: false, groups: [] });
  });

  it('refuses a body the contract does not describe', async () => {
    const refused = await owner.client.post('/v1/grows').send({ name: 'No type at all', plants: [] }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors.map((issue: { field: string }) => issue.field)).toContain('type');
  });
});

describe('entering a phase', () => {
  it('starts the day counter and says who put the grow there', async () => {
    const grow = await startAGrow();

    const phase = await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'seedling' }).expect(201);
    expect(phase.body).toMatchObject({ stage: 'seedling', source: 'human', setBy: owner.userId });

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary).toMatchObject({ dayNumber: 1, weekNumber: 1, stage: 'seedling', phaseDay: 1, isAuto: false });
  });

  it('lists the groups once some of the plants have gone their own way', async () => {
    const grow = await startAGrow();
    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    const one = plants.body.items[0].id;

    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'vegetative' }).expect(201);
    await owner.client
      .post(`/v1/grows/${grow.id}/phases`)
      .send({ stage: 'drying', plantIds: [one] })
      .expect(201);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary.stage).toBe('vegetative');
    expect(read.body.summary.groups.map((group: { stage: string }) => group.stage)).toEqual(['vegetative', 'drying']);
  });

  it('refuses a plant that is not in this grow', async () => {
    const grow = await startAGrow();
    const refused = await owner.client
      .post(`/v1/grows/${grow.id}/phases`)
      .send({ stage: 'drying', plantIds: ['not-a-plant'] })
      .expect(422);

    expect(refused.body.code).toBe('plants_not_in_grow');
  });
});

describe('moving plants', () => {
  it('leaves the ones that stayed where they were, and says where each of them is', async () => {
    const grow = await startAGrow();
    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    const moving = plants.body.items[0].id;

    await owner.client
      .post(`/v1/grows/${grow.id}/placements`)
      .send({ spaceId: null, plantIds: [moving] })
      .expect(201);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary.locations).toEqual([
      { spaceId: tent, plantIds: plants.body.items.slice(1).map((plant: { id: string }) => plant.id) },
      { spaceId: null, plantIds: [moving] },
    ]);
  });
});

describe('somebody else´s grow', () => {
  it('is not there as far as a stranger is concerned', async () => {
    const grow = await startAGrow();

    const refused = await stranger.client.get(`/v1/grows/${grow.id}`).expect(404);
    expect(refused.body.code).toBe('grow_not_found');

    await stranger.client.patch(`/v1/grows/${grow.id}`).send({ name: 'Mine now' }).expect(404);
    await stranger.client.delete(`/v1/grows/${grow.id}`).expect(404);
  });

  it('is not in the list either', async () => {
    await startAGrow();
    const listed = await stranger.client.get('/v1/grows').expect(200);

    expect(listed.body.items).toEqual([]);
  });
});

describe('ending a grow', () => {
  it('stops the day counter where it stopped', async () => {
    const grow = await startAGrow();
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'flowering' }).expect(201);

    const endedAt = new Date().toISOString();
    const ended = await owner.client.patch(`/v1/grows/${grow.id}`).send({ endedAt }).expect(200);

    expect(ended.body.endedAt).toBe(endedAt);
    expect(ended.body.summary.dayNumber).toBe(1);
  });

  it('takes its plants with it when it is deleted', async () => {
    const grow = await startAGrow();
    await owner.client.delete(`/v1/grows/${grow.id}`).expect(204);

    await owner.client.get(`/v1/grows/${grow.id}`).expect(404);
  });
});
