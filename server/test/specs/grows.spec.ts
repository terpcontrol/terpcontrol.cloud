import { anonymous, createAccount, Session } from '../support/api';
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

describe('correcting what was written down', () => {
  const plantsOf = async (growId: string): Promise<string[]> =>
    (await owner.client.get(`/v1/grows/${growId}/plants`).expect(200)).body.items.map((plant: { id: string }) => plant.id);

  const diaryOf = async (growId: string, kind: string) =>
    (await owner.client.get(`/v1/entries?growId=${growId}&kinds=${kind}`).expect(200)).body.items;

  it('moves a phase and the line that announced it to the day it really began', async () => {
    const grow = await startAGrow();
    const phase = await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'seedling' }).expect(201);

    const reallyBegan = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const corrected = await owner.client
      .patch(`/v1/grows/${grow.id}/phases/${phase.body.id}`)
      .send({ stage: 'vegetative', startedAt: reallyBegan })
      .expect(200);

    expect(corrected.body).toMatchObject({ stage: 'vegetative', startedAt: reallyBegan, source: 'human', setBy: owner.userId });
    expect((await owner.client.get(`/v1/grows/${grow.id}`).expect(200)).body.summary).toMatchObject({ dayNumber: 7, stage: 'vegetative' });

    const [line] = await diaryOf(grow.id, 'phase');
    expect(line).toMatchObject({ occurredAt: reallyBegan, values: { stage: 'vegetative' } });
  });

  it('takes a phase back together with the line that announced it', async () => {
    const grow = await startAGrow();
    const phase = await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'seedling' }).expect(201);

    await owner.client.delete(`/v1/grows/${grow.id}/phases/${phase.body.id}`).expect(204);

    expect((await owner.client.get(`/v1/grows/${grow.id}`).expect(200)).body.phases).toEqual([]);
    expect(await diaryOf(grow.id, 'phase')).toEqual([]);
    await owner.client.delete(`/v1/grows/${grow.id}/phases/${phase.body.id}`).expect(404);
  });

  it('closes a placement on the day the plants really left', async () => {
    const grow = await startAGrow();
    const moved = await owner.client
      .post(`/v1/grows/${grow.id}/placements`)
      .send({ spaceId: null, plantIds: [(await plantsOf(grow.id))[0]] })
      .expect(201);

    const left = new Date().toISOString();
    const closed = await owner.client.patch(`/v1/grows/${grow.id}/placements/${moved.body.id}`).send({ endedAt: left }).expect(200);

    expect(closed.body.endedAt).toBe(left);
  });

  it('refuses the only placement that says where the grow is', async () => {
    const grow = await startAGrow();
    const refused = await owner.client.delete(`/v1/grows/${grow.id}/placements/${grow.placements[0].id}`).expect(409);

    expect(refused.body.code).toBe('grow_stands_nowhere');
  });

  it('takes a move back together with its line', async () => {
    const grow = await startAGrow();
    // One plant, so that the rest of the grow keeps an open placement: a grow
    // always answers where it is, and the last one saying so is not removed.
    const moved = await owner.client
      .post(`/v1/grows/${grow.id}/placements`)
      .send({ spaceId: null, plantIds: [(await plantsOf(grow.id))[0]] })
      .expect(201);

    await owner.client.delete(`/v1/grows/${grow.id}/placements/${moved.body.id}`).expect(204);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.placements.map((row: { id: string }) => row.id)).not.toContain(moved.body.id);
    expect(await diaryOf(grow.id, 'move')).toEqual([]);
  });
});

describe('harvesting', () => {
  it('cuts the whole grow down, weighs it and ends it', async () => {
    const grow = await startAGrow();
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'flowering' }).expect(201);

    const harvestedAt = new Date().toISOString();
    const cut = await owner.client.post(`/v1/grows/${grow.id}/harvests`).send({ harvestedAt, wetWeightG: 900, dryWeightG: 210 }).expect(201);

    expect(cut.body.plants).toHaveLength(3);
    expect(cut.body.plants.every((plant: { status: string }) => plant.status === 'harvested')).toBe(true);
    expect(cut.body.entryId).toEqual(expect.any(String));

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.endedAt).toBe(harvestedAt);
  });

  it('leaves the grow running while some of its plants stay up', async () => {
    const grow = await startAGrow();
    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    const first = plants.body.items[0].id;

    const cut = await owner.client
      .post(`/v1/grows/${grow.id}/harvests`)
      .send({ plantIds: [first], wetWeightG: 300 })
      .expect(201);
    expect(cut.body.plants.map((plant: { id: string }) => plant.id)).toEqual([first]);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.endedAt).toBeNull();

    const refused = await owner.client
      .post(`/v1/grows/${grow.id}/harvests`)
      .send({ plantIds: [first] })
      .expect(409);
    expect(refused.body.code).toBe('plants_already_harvested');
  });

  /**
   * The one thing a harvest leaves behind that a stranger could read. The page
   * is asserted against rather than for: a weight that reached it would be a
   * setting somebody turned on and the server ignored.
   */
  it('tells a stranger nothing about what it weighed', async () => {
    const shy = await createAccount('grows-shy');
    await shy.client
      .patch('/v1/me')
      .send({ privacy: { hideWeights: true, hideCounts: false } })
      .expect(200);

    const theirs = (
      await shy.client
        .post('/v1/grows')
        .send({ name: 'Quiet harvest', type: 'autoflower', plants: [{ strain: 'Gelato', count: 2 }] })
        .expect(201)
    ).body;
    await shy.client.post(`/v1/grows/${theirs.id}/phases`).send({ stage: 'flowering' }).expect(201);
    await shy.client.post(`/v1/grows/${theirs.id}/harvests`).send({ wetWeightG: 777, dryWeightG: 181 }).expect(201);
    await shy.client.patch(`/v1/grows/${theirs.id}`).send({ visibility: 'public' }).expect(200);

    const page = await anonymous().get(`/v1/public/grows/${theirs.slug}`).expect(200);
    expect(page.body.harvest).toMatchObject({ wetWeightG: null, dryWeightG: null });
    // As whole numbers rather than as substrings: the page is full of ids, and
    // three digits turn up inside a uuid often enough to fail on a Tuesday.
    expect(JSON.stringify(page.body)).not.toMatch(/\b777\b/);
    expect(JSON.stringify(page.body)).not.toMatch(/\b181\b/);
  });
});

describe('splitting a grow', () => {
  it('sends some of it to dry while the rest goes on flowering', async () => {
    const grow = await startAGrow();
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'flowering' }).expect(201);

    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    const drying = plants.body.items[0].id;

    const split = await owner.client
      .post(`/v1/grows/${grow.id}/splits`)
      .send({ plantIds: [drying], stage: 'drying', spaceId: null })
      .expect(201);

    expect(split.body.phase).toMatchObject({ stage: 'drying', plantIds: [drying] });
    expect(split.body.placement).toMatchObject({ spaceId: null, plantIds: [drying] });

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary.stage).toBe('flowering');
    expect(read.body.summary.groups.map((group: { stage: string }) => group.stage)).toEqual(['flowering', 'drying']);
    expect(read.body.summary.locations).toEqual([
      { spaceId: tent, plantIds: plants.body.items.slice(1).map((plant: { id: string }) => plant.id) },
      { spaceId: null, plantIds: [drying] },
    ]);
  });

  it('refuses a split that gives the plants neither a phase nor a place', async () => {
    const grow = await startAGrow();
    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);

    const refused = await owner.client
      .post(`/v1/grows/${grow.id}/splits`)
      .send({ plantIds: [plants.body.items[0].id] })
      .expect(422);

    expect(refused.body.code).toBe('split_does_nothing');
  });

  it('refuses a split that names no plant at all', async () => {
    const grow = await startAGrow();
    const refused = await owner.client.post(`/v1/grows/${grow.id}/splits`).send({ plantIds: [], stage: 'drying' }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
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

  it('cannot be harvested, split or corrected by one either', async () => {
    const grow = await startAGrow();
    const phase = await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'flowering' }).expect(201);

    await stranger.client.post(`/v1/grows/${grow.id}/harvests`).send({ wetWeightG: 900 }).expect(404);
    await stranger.client.post(`/v1/grows/${grow.id}/splits`).send({ plantIds: [], stage: 'drying' }).expect(404);
    await stranger.client.patch(`/v1/grows/${grow.id}/phases/${phase.body.id}`).send({ stage: 'curing' }).expect(404);
    await stranger.client.delete(`/v1/grows/${grow.id}/phases/${phase.body.id}`).expect(404);
    await stranger.client.patch(`/v1/grows/${grow.id}/placements/${grow.placements[0].id}`).send({ spaceId: null }).expect(404);
    await stranger.client.delete(`/v1/grows/${grow.id}/placements/${grow.placements[0].id}`).expect(404);

    // And none of it happened: the refusal is the guard's, before the handler.
    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body).toMatchObject({ endedAt: null, summary: { stage: 'flowering' } });
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

  /** A grow started ten days ago and ended yesterday, which is what every write below is tried against. */
  const anEndedGrow = async () => {
    const startedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const endedAt = new Date(Date.now() - 86_400_000).toISOString();
    const grow = await startAGrow({ startedAt });
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'flowering', startedAt }).expect(201);
    await owner.client.patch(`/v1/grows/${grow.id}`).send({ endedAt }).expect(200);

    const plants = await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200);
    return { grow, endedAt, plantIds: plants.body.items.map((plant: { id: string }) => plant.id) as string[] };
  };

  it('takes nothing that happens after it ended', async () => {
    const { grow, plantIds } = await anEndedGrow();

    const writes = [
      owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'drying' }),
      owner.client.post(`/v1/grows/${grow.id}/placements`).send({ spaceId: null }),
      owner.client.post(`/v1/grows/${grow.id}/splits`).send({ plantIds: [plantIds[0]], stage: 'drying' }),
      owner.client.post(`/v1/grows/${grow.id}/harvests`).send({ wetWeightG: 100 }),
      owner.client.post('/v1/reminders').send({ subject: { type: 'grow', id: grow.id }, kind: 'water', label: 'Water', everyDays: 1, onceAt: null }),
    ];

    for (const refused of await Promise.all(writes)) {
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('grow_ended');
    }

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.phases).toHaveLength(1);
    expect(read.body.placements.filter((placement: { endedAt: string | null }) => placement.endedAt === null)).toHaveLength(1);
  });

  it('still takes a repair dated inside it, and a move repaired in stays inside it too', async () => {
    const { grow, endedAt } = await anEndedGrow();
    const before = new Date(Date.parse(endedAt) - 3 * 86_400_000).toISOString();

    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'drying', startedAt: before }).expect(201);
    const moved = await owner.client.post(`/v1/grows/${grow.id}/placements`).send({ spaceId: null, startedAt: before }).expect(201);

    expect(moved.body.endedAt).toBe(endedAt);
  });

  it('cannot end before it began, nor start or end in the future', async () => {
    const grow = await startAGrow({ startedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString();

    const backwards = await owner.client.patch(`/v1/grows/${grow.id}`).send({ endedAt: tenDaysAgo }).expect(422);
    expect(backwards.body.code).toBe('grow_ends_before_it_starts');

    const early = await owner.client.patch(`/v1/grows/${grow.id}`).send({ startedAt: inFiveDays }).expect(400);
    expect(early.body.code).toBe('started_in_the_future');

    const late = await owner.client.patch(`/v1/grows/${grow.id}`).send({ endedAt: inFiveDays }).expect(400);
    expect(late.body.code).toBe('ended_in_the_future');
  });

  it('can be reopened, and then goes on taking what happens to it', async () => {
    const { grow } = await anEndedGrow();

    await owner.client.patch(`/v1/grows/${grow.id}`).send({ endedAt: null }).expect(200);
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'drying' }).expect(201);
  });

  it('takes its plants with it when it is deleted', async () => {
    const grow = await startAGrow();
    await owner.client.delete(`/v1/grows/${grow.id}`).expect(204);

    await owner.client.get(`/v1/grows/${grow.id}`).expect(404);
  });
});
