import { anonymous, createAccount, demoSession, Session } from '../support/api';
import { provisionDevice } from '../support/device';

/**
 * The Charts view and the export, over HTTP.
 *
 * The unit suite has the arithmetic and the access matrix against a database;
 * what is checked here is the rest of the way - that the repeated query
 * parameters the chips send arrive as lists, that the export really answers a
 * job and really finishes, that its file comes back through the route that
 * serves any other file, and that nobody but the person who asked for it can
 * see any of it.
 */

let owner: Session;
let stranger: Session;
let tent: string;
let grow: { id: string; slug: string };

/** How long a spec waits for the builder, which wakes a couple of seconds after an export is asked for. */
const READY_TIMEOUT_MS = 60_000;

const startAGrow = async () =>
  (
    await owner.client
      .post('/v1/grows')
      .send({
        name: 'Charts run',
        type: 'photoperiod',
        // Ten days old, so a link can be given a week somewhere inside it.
        startedAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString(),
        plants: [{ strain: 'Amnesia', count: 2 }],
        spaceId: tent,
        measurements: [{ key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true }],
      })
      .expect(201)
  ).body;

/** Polls the job the way a client does: through the media row, until it is ready. */
const waitForTheFile = async (mediaId: string): Promise<Record<string, any>> => {
  const until = Date.now() + READY_TIMEOUT_MS;

  for (;;) {
    const row = (await owner.client.get(`/v1/media/${mediaId}`).expect(200)).body;
    if (row.exportJob.status === 'ready' || row.exportJob.status === 'failed') return row;
    if (Date.now() > until) throw new Error(`The export was still ${row.exportJob.status} after ${READY_TIMEOUT_MS} ms`);

    await new Promise(resolve => setTimeout(resolve, 500));
  }
};

beforeAll(async () => {
  owner = await createAccount('charts-owner');
  stranger = await createAccount('charts-stranger');

  const device = await provisionDevice(owner, 'controller');
  tent = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
  grow = await startAGrow();

  const plants = (await owner.client.get(`/v1/grows/${grow.id}/plants`).expect(200)).body;
  await owner.client
    .post('/v1/entries')
    .send({
      kind: 'measurement',
      growId: grow.id,
      values: { kind: 'measurement', readings: [{ key: 'height', value: 21, plantId: plants.items[0].id }] },
    })
    .expect(201);
});

describe('GET /v1/grows/{id}/series', () => {
  it('draws whatever was ticked, in one answer', async () => {
    const answer = (
      await owner.client.get(`/v1/grows/${grow.id}/series?range=24h&metrics=temperature&metrics=vpd&outputs=light&measurements=height`).expect(200)
    ).body;

    expect(answer).toMatchObject({ growId: grow.id, range: '24h' });
    expect(answer.originAt).toEqual(expect.any(String));
    expect(answer.deviceIds).toHaveLength(1);
    expect(answer.measurements).toHaveLength(1);
    expect(answer.measurements[0].points).toEqual([
      { measuredAt: expect.any(String), value: 21, plantId: expect.any(String), entryId: expect.any(String) },
    ]);
  });

  it('refuses a measurement the grow does not define', async () => {
    const refusal = await owner.client.get(`/v1/grows/${grow.id}/series?range=24h&measurements=girth`).expect(400);

    expect(refusal.body).toMatchObject({ code: 'measurement_not_defined' });
  });

  it('refuses a range that is not one of the chips', async () => {
    await owner.client.get(`/v1/grows/${grow.id}/series?range=fortnight`).expect(400);
  });

  it('is not there at all for a stranger or a demo session', async () => {
    await stranger.client.get(`/v1/grows/${grow.id}/series?range=24h`).expect(404);
    await (await demoSession()).client.get(`/v1/grows/${grow.id}/series?range=24h`).expect(404);
  });

  it('answers a link holder the window the link was given, and no more', async () => {
    const week = { startsAt: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(), endsAt: new Date(Date.now() - 6 * 24 * 3600_000).toISOString() };
    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'grow', id: grow.id }, range: week })
        .expect(201)
    ).body;

    const answer = (await anonymous().get(`/v1/grows/${grow.id}/series?range=grow&measurements=height&share=${link.token}`).expect(200)).body;

    expect(answer.startsAt).toBe(week.startsAt);
    expect(answer.endsAt).toBe(week.endsAt);
    // The reading was written today, which is outside the week the link opens.
    expect(answer.measurements[0].points).toEqual([]);
  });
});

describe('GET /v1/grows/{id}/export', () => {
  it('answers a job, builds the zip, and serves it as any other file', async () => {
    const accepted = await owner.client.get(`/v1/grows/${grow.id}/export`).expect(202);

    expect(accepted.body.queued).toBe(true);
    expect(accepted.body.media).toMatchObject({ kind: 'export', mime: 'application/zip', bytes: 0 });
    expect(accepted.body.media.exportJob).toMatchObject({ status: 'queued', scope: 'grow', growId: grow.id });
    // It hangs off no grow and no space, which is what keeps a link off it.
    expect(accepted.body.media.growId).toBeNull();

    const ready = await waitForTheFile(accepted.body.media.id);
    expect(ready.exportJob).toMatchObject({ status: 'ready', error: null });
    expect(ready.bytes).toBeGreaterThan(0);

    const file = await owner.client.get(`/v1/media/${accepted.body.media.id}/content`).expect(200);
    expect(file.headers['content-type']).toContain('application/zip');
    expect(Number(file.headers['content-length'])).toBe(ready.bytes);
  });

  it('answers the export already there rather than building a second', async () => {
    const again = await owner.client.get(`/v1/grows/${grow.id}/export`).expect(200);

    expect(again.body.queued).toBe(false);
  });

  it('is exported by nobody but its owner', async () => {
    await stranger.client.get(`/v1/grows/${grow.id}/export`).expect(404);
    await (await demoSession()).client.get(`/v1/grows/${grow.id}/export`).expect(404);
    // A link is an identity for reading, and this route takes a session.
    await anonymous().get(`/v1/grows/${grow.id}/export`).expect(401);
  });

  it('tells a stranger nothing about somebody else´s job, not even that it exists', async () => {
    const mine = (await owner.client.get(`/v1/grows/${grow.id}/export`).expect(200)).body;

    await stranger.client.get(`/v1/media/${mine.media.id}`).expect(404);
    await stranger.client.get(`/v1/media/${mine.media.id}/content`).expect(404);
  });
});

describe('GET /v1/me/export', () => {
  it('takes a copy of the whole account', async () => {
    const accepted = await owner.client.get('/v1/me/export').expect(202);

    expect(accepted.body.media.exportJob).toMatchObject({ status: 'queued', scope: 'account', growId: null });

    // Asked again before it is built: the same job, and still something to wait for.
    const again = await owner.client.get('/v1/me/export');
    expect(again.body.media.id).toBe(accepted.body.media.id);
    expect(again.body.queued).toBe(false);
    if (again.body.media.exportJob.status !== 'ready') expect(again.status).toBe(202);

    const ready = await waitForTheFile(accepted.body.media.id);
    expect(ready.exportJob.status).toBe('ready');
    expect(ready.bytes).toBeGreaterThan(0);

    // Once it is built, asking again answers the finished file.
    const done = await owner.client.get('/v1/me/export').expect(200);
    expect(done.body).toMatchObject({ queued: false, media: { id: accepted.body.media.id, exportJob: { status: 'ready' } } });
  });

  it('is refused to a demo session, which has nothing of its own', async () => {
    const refusal = await (await demoSession()).client.get('/v1/me/export').expect(403);

    expect(refusal.body).toMatchObject({ code: 'demo_session' });
  });
});
