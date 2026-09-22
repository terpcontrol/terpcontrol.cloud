import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { claimCodeOf, registerDevice } from '../support/device';
import { shareLinkOnGrow } from '../support/fixtures';

/**
 * The charts somebody saved to come back to.
 *
 * A view holds the question and never an answer: which series, how far back, and
 * how the panels are drawn. So what is worth asserting here is that the four
 * spans the chips over the charts offer all survive a round trip - the two that
 * carry a number and the two that carry none - and that a view is nobody's but
 * its owner's, with no share link, public diary or demo tour reaching one.
 */

let owner: Session;
let stranger: Session;
let admin: Session;
let device: string;
let grow: string;

const aDefinition = (over: Record<string, unknown> = {}) => ({
  deviceIds: [device],
  growId: grow,
  metrics: ['temperature', 'humidity'],
  outputs: ['light'],
  measurements: ['height'],
  span: { kind: 'last', forSeconds: 7 * 24 * 60 * 60 },
  layout: 'stacked',
  intervalSeconds: 300,
  ...over,
});

const aView = (over: Record<string, unknown> = {}) => ({ name: unique('Last week'), definition: aDefinition(), ...over });

const create = async (session: Session, body: Record<string, unknown> = aView()) =>
  (await session.client.post('/v1/chart-views').send(body).expect(201)).body;

beforeAll(async () => {
  owner = await createAccount('charts-owner');
  stranger = await createAccount('charts-stranger');
  admin = await loginAsAdmin();

  const registered = await registerDevice('controller');
  await owner.client
    .post('/v1/devices/claims')
    .send({ code: await claimCodeOf(registered.deviceId) })
    .expect(201);
  device = registered.deviceId;

  grow = (
    await owner.client
      .post('/v1/grows')
      .send({ name: unique('Spring run'), type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }] })
      .expect(201)
  ).body.id;
});

describe('saving a chart', () => {
  it('keeps every series the chip bar offers, climate, outputs and the grow of its own', async () => {
    const saved = await create(owner, aView({ name: 'Everything' }));

    expect(saved).toMatchObject({ ownerId: owner.userId, name: 'Everything' });
    expect(saved.definition).toEqual(aDefinition());
  });

  it('keeps a rolling span and a fixed one, each carrying only what its kind has', async () => {
    const rolling = await create(owner, aView({ definition: aDefinition({ span: { kind: 'last', forSeconds: 86400 } }) }));
    expect(rolling.definition.span).toEqual({ kind: 'last', forSeconds: 86400 });

    const fixed = await create(
      owner,
      aView({
        definition: aDefinition({
          span: { kind: 'fixed', range: { startsAt: '2026-03-01T00:00:00.000Z', endsAt: '2026-03-08T00:00:00.000Z' } },
        }),
      }),
    );
    expect(fixed.definition.span).toEqual({
      kind: 'fixed',
      range: { startsAt: '2026-03-01T00:00:00.000Z', endsAt: '2026-03-08T00:00:00.000Z' },
    });
  });

  it('keeps the two spans that have no dates of their own, and stores none for them', async () => {
    for (const kind of ['phase', 'grow']) {
      const saved = await create(owner, aView({ definition: aDefinition({ span: { kind } }) }));

      expect(saved.definition.span).toEqual({ kind });
      expect(saved.definition.span).not.toHaveProperty('forSeconds');
      expect(saved.definition.span).not.toHaveProperty('range');
    }
  });

  it('keeps each of the three layouts', async () => {
    for (const layout of ['stacked', 'overlay', 'day_of_grow']) {
      const saved = await create(owner, aView({ definition: aDefinition({ layout }) }));
      expect(saved.definition.layout).toBe(layout);
    }
  });

  it('refuses a span that names no kind, one whose seconds are not a span, and a layout the charts cannot draw', async () => {
    await owner.client
      .post('/v1/chart-views')
      .send(aView({ definition: aDefinition({ span: { forSeconds: 600 } }) }))
      .expect(400);
    await owner.client
      .post('/v1/chart-views')
      .send(aView({ definition: aDefinition({ span: { kind: 'last', forSeconds: 0 } }) }))
      .expect(400);
    await owner.client
      .post('/v1/chart-views')
      .send(aView({ definition: aDefinition({ layout: 'spiral' }) }))
      .expect(400);
  });

  it('renames without being handed the definition again, and changes what it draws without being renamed', async () => {
    const saved = await create(owner);

    const renamed = await owner.client.patch(`/v1/chart-views/${saved.id}`).send({ name: 'Flower weeks' }).expect(200);
    expect(renamed.body).toMatchObject({ id: saved.id, name: 'Flower weeks' });
    expect(renamed.body.definition).toEqual(aDefinition());

    const redrawn = await owner.client
      .patch(`/v1/chart-views/${saved.id}`)
      .send({ definition: aDefinition({ span: { kind: 'grow' }, layout: 'overlay' }) })
      .expect(200);
    expect(redrawn.body.name).toBe('Flower weeks');
    expect(redrawn.body.definition.span).toEqual({ kind: 'grow' });
  });

  it('throws one away without touching what it drew', async () => {
    const saved = await create(owner);

    await owner.client.delete(`/v1/chart-views/${saved.id}`).expect(204);
    await owner.client.patch(`/v1/chart-views/${saved.id}`).send({ name: 'Back' }).expect(404);
    await owner.client.get(`/v1/grows/${grow}`).expect(200);
  });
});

describe('whose view it is', () => {
  let mine: Record<string, unknown>;

  beforeAll(async () => {
    mine = await create(owner, aView({ name: unique('Only mine') }));
  });

  it('is missing from a stranger, who cannot list it, change it or delete it', async () => {
    const theirs = await stranger.client.get('/v1/chart-views').expect(200);
    expect(theirs.body.items.map((row: { id: string }) => row.id)).not.toContain(mine.id);

    await stranger.client.patch(`/v1/chart-views/${mine.id}`).send({ name: 'Taken' }).expect(404);
    await stranger.client.delete(`/v1/chart-views/${mine.id}`).expect(404);
  });

  it('is not reached by a share link on the grow the view is about', async () => {
    const token = unique('charttoken').replace(/-/g, '');
    await shareLinkOnGrow(grow, token);

    // The link is live - it opens the diary of the grow it names - and reaches
    // no further: a view is not a subject `access()` decides about, so there is
    // no window onto one at all.
    await anonymous().get(`/v1/entries?growId=${grow}`).set('X-Share-Token', token).expect(200);
    await anonymous().get('/v1/chart-views').set('X-Share-Token', token).expect(401);
    await anonymous().patch(`/v1/chart-views/${mine.id}`).set('X-Share-Token', token).send({ name: 'Taken' }).expect(401);
  });

  it('is not reached without a session at all', async () => {
    await anonymous().get('/v1/chart-views').expect(401);
    await anonymous().post('/v1/chart-views').send(aView()).expect(401);
  });

  it('leaves the demo tour with none, and lets it save none', async () => {
    const demo = await demoSession();

    const listed = await demo.client.get('/v1/chart-views').expect(200);
    expect(listed.body.items).toEqual([]);
    await demo.client.post('/v1/chart-views').send(aView()).expect(403);
  });
});

describe('the list', () => {
  it('holds the visibility filter on every page, not only the first', async () => {
    const shelf = await createAccount('charts-shelf');
    for (let made = 0; made < 3; made += 1) await create(shelf, aView());
    await create(owner, aView({ name: unique('Not theirs') }));

    const first = await shelf.client.get('/v1/chart-views?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await shelf.client.get(`/v1/chart-views?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`).expect(200);
    const seen = [...first.body.items, ...second.body.items];

    expect(seen).toHaveLength(3);
    expect(seen.every((row: { ownerId: string }) => row.ownerId === shelf.userId)).toBe(true);
  });
});

describe('an admin', () => {
  it('reaches a saved view, because an admin reaches everything', async () => {
    const saved = await create(owner, aView({ name: unique('Reachable') }));
    const renamed = await admin.client.patch(`/v1/chart-views/${saved.id}`).send({ name: 'Renamed by an admin' }).expect(200);

    expect(renamed.body.name).toBe('Renamed by an admin');
  });

  /**
   * The list is the notebook, and a notebook is one person's. Being able to
   * open a page of somebody else's when asked to is not the same as being
   * handed all of them unasked.
   */
  it('is listed their own saved views and none of somebody else´s', async () => {
    const saved = await create(owner, aView({ name: unique('Theirs alone') }));

    const listed = (await admin.client.get('/v1/chart-views?limit=200').expect(200)).body.items;

    expect(listed.map((row: { id: string }) => row.id)).not.toContain(saved.id);
  });
});
