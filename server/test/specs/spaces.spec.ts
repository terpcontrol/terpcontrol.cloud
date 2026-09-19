import { createAccount, Session } from '../support/api';
import { provisionDevice } from '../support/device';
import { joinSpace } from '../support/fixtures';

/**
 * A space over HTTP: the places somebody grows in, the room that groups them,
 * and what the server refuses to do to one from outside.
 *
 * What the unit suite cannot see is here: the status codes, the body a bad
 * request is refused with, and that a caller who has nothing to do with a space
 * is told it does not exist rather than that they may not have it.
 */

let owner: Session;
let stranger: Session;

const makeSpace = async (session: Session, body: Record<string, unknown>): Promise<string> => {
  const made = await session.client.post('/v1/spaces').send(body).expect(201);
  return made.body.id;
};

const listed = async (session: Session, query = ''): Promise<string[]> => {
  const page = await session.client.get(`/v1/spaces${query}`).expect(200);
  return page.body.items.map((space: { id: string }) => space.id);
};

beforeAll(async () => {
  owner = await createAccount('spaces-owner');
  stranger = await createAccount('spaces-stranger');
});

describe('making a space', () => {
  it('needs a kind and a name, and fills the rest in', async () => {
    const made = await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'The tent' }).expect(201);

    expect(made.body).toMatchObject({
      ownerId: owner.userId,
      kind: 'tent',
      name: 'The tent',
      roomId: null,
      presetPrompt: 'ask',
      retention: { climateDays: null },
      archivedAt: null,
    });
  });

  it('groups one under a room', async () => {
    const roomId = await makeSpace(owner, { kind: 'room', name: 'The flower room' });
    const made = await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Tent in it', roomId }).expect(201);

    expect(made.body.roomId).toBe(roomId);
    expect(await listed(owner, `?roomId=${roomId}`)).toEqual([made.body.id]);
  });

  it('refuses a kind the contract does not have, and says which field', async () => {
    const refused = await owner.client.post('/v1/spaces').send({ kind: 'shed', name: 'The shed' }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors.map((error: { field: string }) => error.field)).toContain('kind');
  });

  it('refuses a room inside somebody else´s room as if it were not there', async () => {
    const roomId = await makeSpace(owner, { kind: 'room', name: 'Not yours' });
    const refused = await stranger.client.post('/v1/spaces').send({ kind: 'tent', name: 'Mine', roomId }).expect(404);

    expect(refused.body.code).toBe('space_not_found');
  });
});

describe('one space', () => {
  it('is renamed by its owner and read back', async () => {
    const id = await makeSpace(owner, { kind: 'fridge', name: 'The fridge' });
    await owner.client.patch(`/v1/spaces/${id}`).send({ name: 'The drying fridge' }).expect(200);

    expect((await owner.client.get(`/v1/spaces/${id}`).expect(200)).body.name).toBe('The drying fridge');
  });

  it('is not there at all for somebody else', async () => {
    const id = await makeSpace(owner, { kind: 'balcony', name: 'The balcony' });

    await stranger.client.get(`/v1/spaces/${id}`).expect(404);
    await stranger.client.patch(`/v1/spaces/${id}`).send({ name: 'Mine now' }).expect(404);
    await stranger.client.delete(`/v1/spaces/${id}`).expect(404);
  });

  it('leaves the list when it is archived and comes back when it is not', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The spare tent' });

    await owner.client.put(`/v1/spaces/${id}/archive`).expect(200);
    expect(await listed(owner)).not.toContain(id);
    expect(await listed(owner, '?archived=true')).toContain(id);

    await owner.client.delete(`/v1/spaces/${id}/archive`).expect(200);
    expect(await listed(owner)).toContain(id);
  });
});

describe('what stands in a space', () => {
  it('takes a device in and lets it go again', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The new tent' });
    const device = await provisionDevice(owner);

    const placed = await owner.client.put(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(200);
    expect(placed.body.spaceId).toBe(id);

    await owner.client.delete(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(204);
    expect((await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId).toBeNull();
  });

  it('refuses to end a space while a device stands there, and says what does', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The occupied tent' });
    const device = await provisionDevice(owner);
    await owner.client.put(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(200);

    const refused = await owner.client.delete(`/v1/spaces/${id}`).expect(409);
    expect(refused.body.code).toBe('space_in_use');
    expect(refused.body.errors.map((error: { code: string }) => error.code)).toEqual(['device_here']);

    await owner.client.delete(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(204);
    await owner.client.delete(`/v1/spaces/${id}`).expect(204);
  });

  /**
   * A person is not something a delete button removes in passing. The refusal
   * has to stand on its own at the wire, because the sentence a client shows is
   * the one the server wrote: a bare `member_here` would have the app make one
   * up.
   */
  it('refuses to end a space while somebody else is a member of it', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The shared tent' });
    await joinSpace(id, stranger.userId);

    const refused = await owner.client.delete(`/v1/spaces/${id}`).expect(409);

    expect(refused.body).toMatchObject({ status: 409, code: 'space_in_use' });
    expect(refused.body.errors).toEqual([
      { field: 'id', code: 'member_here', detail: 'Somebody else is a member of this space. Remove them from it first.' },
    ]);
    // Refused and unchanged: the space is still in the list and still open.
    expect(await listed(owner)).toContain(id);
    expect((await owner.client.get(`/v1/spaces/${id}`).expect(200)).body.archivedAt).toBeNull();
  });

  it('keeps an ended space readable, because history still names it', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The ended tent' });
    await owner.client.delete(`/v1/spaces/${id}`).expect(204);

    expect(await listed(owner)).not.toContain(id);
    expect((await owner.client.get(`/v1/spaces/${id}`).expect(200)).body.archivedAt).toEqual(expect.any(String));
  });
});

/**
 * The phase tiles over HTTP: the tent is put on the stage's climate, the grow
 * standing in it enters the stage, and where there is no grow the answer asks
 * what to do about that rather than inventing one.
 */
describe('applying a climate preset', () => {
  /** A tent with a controller in it that has said what it is running, which is what a preset is merged into. */
  const tentWithAController = async (): Promise<string> => {
    const device = await provisionDevice(owner, 'controller');
    const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId as string;

    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({
        configuration: {
          daynight: { day: 21600, night: 64800 },
          day: { temperature: 25, humidity: 60 },
          night: { temperature: 21, humidity: 55 },
          lights: { sunrise: 15, sunset: 15, limit: 100 },
        },
      })
      .expect(200);

    return spaceId;
  };

  it('writes the stage´s climate to the controller and asks what to do about the grow', async () => {
    const spaceId = await tentWithAController();

    const applied = await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(201);

    expect(applied.body).toMatchObject({ spaceId, stage: 'vegetative', preset: null, growId: null, growDecisionNeeded: true, planEffect: 'none' });
    expect(applied.body.decisions).toEqual(['start_grow', 'move_grow', 'climate_only']);
    expect(applied.body.deviceIds).toHaveLength(1);

    const read = await owner.client.get(`/v1/devices/${applied.body.deviceIds[0]}/configuration`).expect(200);
    // The targets of the stage, and the ramps the tent was tuned with left alone.
    expect(read.body.configuration).toMatchObject({
      day: { temperature: 26, humidity: 62 },
      night: { temperature: 22, humidity: 58 },
      lights: { sunrise: 15, sunset: 15, limit: 80 },
    });
  });

  it('puts the grow standing there into the stage and tags the phase as the preset´s', async () => {
    const spaceId = await tentWithAController();
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({ name: 'Preset run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }], spaceId })
        .expect(201)
    ).body;

    const applied = await owner.client
      .post(`/v1/spaces/${spaceId}/preset-applications`)
      .send({ stage: 'flowering', preset: 'late_flowering' })
      .expect(201);

    expect(applied.body).toMatchObject({ growId: grow.id, growDecisionNeeded: false, decisions: [] });
    expect(applied.body.phaseId).toEqual(expect.any(String));

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary).toMatchObject({ stage: 'flowering', preset: 'late_flowering', isAuto: true });
    expect(read.body.phases[0]).toMatchObject({ source: 'preset', setBy: null });
    expect(read.body.phases[0].targets).toMatchObject({ day: { temperature: 24 } });
  });

  it('refuses a stage the contract does not have', async () => {
    const spaceId = await tentWithAController();
    const refused = await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'harvesting' }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
  });

  it('is not a space a stranger can reach at all', async () => {
    const spaceId = await tentWithAController();
    const refused = await stranger.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(404);

    expect(refused.body.code).toBe('space_not_found');
  });
});
