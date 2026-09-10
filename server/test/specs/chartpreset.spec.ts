import { anonymous, createAccount, demoSession, Session } from '../support/api';

let owner: Session;

beforeAll(async () => {
  owner = await createAccount('preset-owner');
});

const createPreset = (overrides: Record<string, unknown> = {}) =>
  owner.client.post('/chartpresets').send({ name: 'Week overview', query: 'measure=temperature&days=7', ...overrides });

describe('POST /chartpresets', () => {
  it('creates a preset owned by the caller', async () => {
    const response = await createPreset({ name: 'Fridge week', device_type: 'fridge' }).expect(201);

    expect(response.body).toMatchObject({
      preset_id: expect.any(String),
      name: 'Fridge week',
      device_type: 'fridge',
      query: 'measure=temperature&days=7',
      owner_id: owner.userId,
    });
  });

  it('trims the name', async () => {
    const response = await createPreset({ name: '  padded  ' }).expect(201);
    expect(response.body.name).toBe('padded');
  });

  it('truncates an over-long device type instead of rejecting it', async () => {
    const response = await createPreset({ device_type: 'x'.repeat(60) }).expect(201);
    expect(response.body.device_type).toHaveLength(40);
  });

  it('rejects a missing or blank name', async () => {
    await owner.client.post('/chartpresets').send({ query: 'a=b' }).expect(400);
    await createPreset({ name: '   ' }).expect(400);
  });

  it('rejects a name over 60 characters', async () => {
    await createPreset({ name: 'x'.repeat(61) }).expect(400);
  });

  it('rejects a missing query', async () => {
    await owner.client.post('/chartpresets').send({ name: 'No query' }).expect(400);
  });

  it('rejects a query over 2000 characters', async () => {
    await createPreset({ query: 'x'.repeat(2001) }).expect(400);
  });

  it('requires a session', async () => {
    await anonymous().post('/chartpresets').send({ name: 'x', query: 'y' }).expect(401);
  });

  it('refuses a demo session', async () => {
    const demo = await demoSession();
    await demo.client.post('/chartpresets').send({ name: 'x', query: 'y' }).expect(403);
  });
});

describe('GET /chartpresets', () => {
  it('lists only the caller´s presets, newest first', async () => {
    const lister = await createAccount('preset-lister');
    const stranger = await createAccount('preset-stranger');

    await stranger.client.post('/chartpresets').send({ name: 'Theirs', query: 'a=b' }).expect(201);
    await lister.client.post('/chartpresets').send({ name: 'First', query: 'a=b' }).expect(201);
    await new Promise(resolve => setTimeout(resolve, 5));
    await lister.client.post('/chartpresets').send({ name: 'Second', query: 'a=b' }).expect(201);

    const response = await lister.client.get('/chartpresets').expect(200);

    expect(response.body.map((preset: { name: string }) => preset.name)).toEqual(['Second', 'First']);
  });

  it('requires a session', async () => {
    await anonymous().get('/chartpresets').expect(401);
  });
});

describe('DELETE /chartpresets/:preset_id', () => {
  it('removes the caller´s preset', async () => {
    const created = await createPreset({ name: 'Doomed' }).expect(201);

    await owner.client.delete(`/chartpresets/${created.body.preset_id}`).expect(200);

    const remaining = await owner.client.get('/chartpresets').expect(200);
    expect(remaining.body.find((preset: { preset_id: string }) => preset.preset_id === created.body.preset_id)).toBeUndefined();
  });

  it('will not delete somebody else´s preset', async () => {
    const stranger = await createAccount('preset-thief');
    const created = await createPreset({ name: 'Protected' }).expect(201);

    await stranger.client.delete(`/chartpresets/${created.body.preset_id}`).expect(404);

    await owner.client.get(`/chartpresets`).expect(200);
  });

  it('reports an unknown preset as not found', async () => {
    await owner.client.delete('/chartpresets/does-not-exist').expect(404);
  });

  it('requires a session', async () => {
    await anonymous().delete('/chartpresets/anything').expect(401);
  });
});
