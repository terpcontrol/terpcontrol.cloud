import { anonymous, createAccount, Session } from '../support/api';
import { provisionDevice } from '../support/device';

/**
 * Handing a diary out: the links somebody makes, and the diaries they follow.
 *
 * Everything here is the owner's side of sharing, so every route takes a
 * session. What a reader does with what comes out of it is the other spec.
 *
 * The one case worth stating twice is the list: its visibility filter is an
 * `$or` and so is the cursor, so the second page is checked as well as the
 * first - a list that combines the two wrongly looks right until somebody
 * scrolls.
 */

let owner: Session;
let stranger: Session;
let tent: string;
let grow: { id: string; slug: string };

const startAGrow = async (over: Record<string, unknown> = {}) =>
  (
    await owner.client
      .post('/v1/grows')
      .send({ name: 'Sharing run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 2 }], spaceId: tent, ...over })
      .expect(201)
  ).body;

const aLink = async (over: Record<string, unknown> = {}) =>
  (
    await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'grow', id: grow.id }, ...over })
      .expect(201)
  ).body;

beforeAll(async () => {
  owner = await createAccount('sharing-owner');
  stranger = await createAccount('sharing-stranger');

  const device = await provisionDevice(owner, 'controller');
  tent = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;

  grow = await startAGrow();
  await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'vegetative' }).expect(201);
});

describe('making a link', () => {
  it('invents the token, the author and the counters, whatever the body says', async () => {
    const created = await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'grow', id: grow.id }, token: 'chosen-by-the-client', createdBy: stranger.userId })
      .expect(201);

    expect(created.body.token).toEqual(expect.any(String));
    expect(created.body.token).not.toBe('chosen-by-the-client');
    expect(created.body.token.length).toBeGreaterThan(20);
    expect(created.body.createdBy).toBe(owner.userId);
    expect(created.body.state).toEqual({ openCount: 0, lastOpenedAt: null });
    // A link carries no pictures unless it was made to.
    expect(created.body.includeCameras).toBe(false);
    expect(created.body.range).toEqual({ startsAt: null, endsAt: null });
  });

  it('is the owner´s to make, and nobody else´s', async () => {
    await stranger.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'grow', id: grow.id } })
      .expect(404);
  });

  it('refuses a subject that is not a grow or a space', async () => {
    const refused = await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'device', id: 'whatever' } })
      .expect(400);

    expect(refused.body.code).toBe('validation_failed');
  });
});

describe('the list of links', () => {
  it('holds this account´s and nobody else´s, page after page', async () => {
    await aLink();
    await aLink();
    await aLink();

    const strangerGrow = (await stranger.client.post('/v1/grows').send({ name: 'Not yours', type: 'autoflower', plants: [] }).expect(201)).body;
    await stranger.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'grow', id: strangerGrow.id } })
      .expect(201);

    // Page by page, because the visibility filter and the cursor are each an
    // `$or`: merged into one object rather than combined, the second page would
    // answer every link in the database.
    const seen: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const where: string = `/v1/share-links?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await owner.client.get(where).expect(200);
      seen.push(...page.body.items);
      cursor = page.body.nextCursor as string | null;
    } while (cursor && seen.length < 20);

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(link => link.createdBy === owner.userId)).toBe(true);
  });
});

describe('a link that is already out of the house', () => {
  it('is narrowed but never repointed', async () => {
    const link = await aLink({ includeCameras: true });
    const elsewhere = await startAGrow({ name: 'Somewhere else' });

    const patched = await owner.client
      .patch(`/v1/share-links/${link.id}`)
      .send({
        includeCameras: false,
        range: { startsAt: '2026-05-01T00:00:00.000Z', endsAt: null },
        kind: 'public_page',
        subject: { type: 'grow', id: elsewhere.id },
      })
      .expect(200);

    expect(patched.body.includeCameras).toBe(false);
    expect(patched.body.range).toEqual({ startsAt: '2026-05-01T00:00:00.000Z', endsAt: null });
    // The address is in somebody else's hands: what it leads to cannot change.
    expect(patched.body.kind).toBe('view');
    expect(patched.body.subject).toEqual({ type: 'grow', id: grow.id });
  });

  /**
   * Narrowing is the point of the route, so what it narrows is asserted rather
   * than assumed: the window belongs to the link, and a link handed back a
   * narrower one has to answer less from the next read on.
   */
  it('answers less the moment it is narrowed, and not merely a smaller list of weeks', async () => {
    const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const run = (
      await owner.client
        .post('/v1/grows')
        .send({ name: 'Narrowing run', type: 'photoperiod', startedAt: daysAgo(10), plants: [], spaceId: tent })
        .expect(201)
    ).body;
    await owner.client
      .post(`/v1/grows/${run.id}/phases`)
      .send({ stage: 'vegetative', startedAt: daysAgo(10) })
      .expect(201);
    await owner.client
      .post('/v1/entries')
      .send({ kind: 'note', growId: run.id, text: 'Early days', occurredAt: daysAgo(8), values: { kind: 'note' } })
      .expect(201);
    await owner.client
      .post('/v1/entries')
      .send({ kind: 'note', growId: run.id, text: 'Lately', values: { kind: 'note' } })
      .expect(201);

    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'grow', id: run.id } })
        .expect(201)
    ).body;

    const wide = await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    expect(JSON.stringify(wide.body)).toContain('Early days');

    await owner.client
      .patch(`/v1/share-links/${link.id}`)
      .send({ range: { startsAt: daysAgo(1), endsAt: null } })
      .expect(200);

    const narrowed = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    // Not "a week that touches the window", which is how up to seven days on
    // each side of it used to come out with it.
    expect(JSON.stringify(narrowed.body)).not.toContain('Early days');
    expect(JSON.stringify(narrowed.body)).toContain('Lately');
  });

  it('stops naming the camera at all once it is told not to carry pictures', async () => {
    const cam = (
      await owner.client.post('/v1/cameras').send({ kind: 'rtsp', spaceId: tent, name: 'Sharing cam', url: 'rtsp://10.0.0.40:554/s' }).expect(201)
    ).body;

    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'space', id: tent }, includeCameras: true })
        .expect(201)
    ).body;

    const shown = await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    expect(JSON.stringify(shown.body)).toContain(cam.id);

    await owner.client.patch(`/v1/share-links/${link.id}`).send({ includeCameras: false }).expect(200);

    const hidden = await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    // Absent, not hidden: that a camera hangs in the tent is as much of the
    // tent as the pictures it takes.
    expect(hidden.body.subject.space.cameras).toEqual([]);
    expect(JSON.stringify(hidden.body)).not.toContain(cam.id);
  });

  it('is revoked rather than deleted, and revoking twice keeps the instant', async () => {
    const link = await aLink();

    const revoked = await owner.client.put(`/v1/share-links/${link.id}/revocation`).expect(200);
    expect(revoked.body.revokedAt).toEqual(expect.any(String));

    const again = await owner.client.put(`/v1/share-links/${link.id}/revocation`).expect(200);
    expect(again.body.revokedAt).toBe(revoked.body.revokedAt);

    await anonymous().get(`/v1/shared/${link.token}`).expect(404);
  });

  it('is deleted outright where somebody wants it forgotten', async () => {
    const link = await aLink();

    await owner.client.delete(`/v1/share-links/${link.id}`).expect(204);
    await owner.client.delete(`/v1/share-links/${link.id}`).expect(404);
    await anonymous().get(`/v1/shared/${link.token}`).expect(404);
  });

  it('is not there as far as anybody else is concerned', async () => {
    const link = await aLink();

    await stranger.client.patch(`/v1/share-links/${link.id}`).send({ includeCameras: true }).expect(404);
    await stranger.client.put(`/v1/share-links/${link.id}/revocation`).expect(404);
    await stranger.client.delete(`/v1/share-links/${link.id}`).expect(404);

    // And a token is not an id: knowing one tells you nothing about the other.
    await stranger.client.patch(`/v1/share-links/${link.token}`).send({ includeCameras: true }).expect(404);
  });

  it('goes with what it points at, because a link is decided by that and would outlive it', async () => {
    const doomed = await startAGrow({ name: 'Not for long' });
    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'grow', id: doomed.id } })
        .expect(201)
    ).body;

    // A space that ends is not removed - history still names it - but the way in
    // that a link is goes with it, as a membership does.
    const shed = (await owner.client.post('/v1/spaces').send({ kind: 'other', name: 'The shed' }).expect(201)).body;
    const onTheShed = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'space', id: shed.id } })
        .expect(201)
    ).body;

    await owner.client.delete(`/v1/grows/${doomed.id}`).expect(204);
    await owner.client.delete(`/v1/spaces/${shed.id}`).expect(204);

    const listed = await owner.client.get('/v1/share-links?limit=200').expect(200);
    const ids = listed.body.items.map((one: { id: string }) => one.id);

    expect(ids).not.toContain(link.id);
    expect(ids).not.toContain(onTheShed.id);
    await anonymous().get(`/v1/shared/${link.token}`).expect(404);
    await anonymous().get(`/v1/shared/${onTheShed.token}`).expect(404);
  });
});

describe('following a grow', () => {
  let published: { id: string; slug: string };

  beforeAll(async () => {
    published = await startAGrow({ name: 'Out in the open' });
    await owner.client.patch(`/v1/grows/${published.id}`).send({ visibility: 'public' }).expect(200);
  });

  it('is a state rather than an event, so following twice is one follow', async () => {
    const first = await stranger.client.put(`/v1/follows/${published.id}`).expect(200);
    const second = await stranger.client.put(`/v1/follows/${published.id}`).expect(200);

    expect(first.body).toMatchObject({ userId: stranger.userId, growId: published.id });
    expect(second.body.id).toBe(first.body.id);

    const listed = await stranger.client.get('/v1/follows').expect(200);
    expect(listed.body.items.filter((follow: { growId: string }) => follow.growId === published.id)).toHaveLength(1);
  });

  it('puts the grow on the home screen as its public page draws it', async () => {
    await stranger.client.put(`/v1/follows/${published.id}`).expect(200);

    const home = await stranger.client.get('/v1/home').expect(200);
    const card = home.body.followedGrows.find((one: { growId: string }) => one.growId === published.id);

    expect(card).toMatchObject({ slug: published.slug, name: 'Out in the open' });
    // The handle is the only name anybody outside the account ever sees.
    expect(card.handle).toEqual(expect.any(String));
    expect(JSON.stringify(card)).not.toContain(owner.userId);
  });

  it('is refused on a grow that has no public page, and hidden on one that is not theirs to see', async () => {
    // The owner may look at their own private grow, so they are told why.
    const refused = await owner.client.put(`/v1/follows/${grow.id}`).expect(409);
    expect(refused.body.code).toBe('grow_not_public');

    // A stranger may not, so they are told nothing - not even that it exists.
    await stranger.client.put(`/v1/follows/${grow.id}`).expect(404);
    await stranger.client.put('/v1/follows/not-a-grow-at-all').expect(404);
  });

  it('is undone whatever state it was in, because a grow gone private is the one you want to drop', async () => {
    await stranger.client.put(`/v1/follows/${published.id}`).expect(200);

    await stranger.client.delete(`/v1/follows/${published.id}`).expect(204);
    await stranger.client.delete(`/v1/follows/${published.id}`).expect(204);

    const listed = await stranger.client.get('/v1/follows').expect(200);
    expect(listed.body.items.filter((follow: { growId: string }) => follow.growId === published.id)).toHaveLength(0);
  });

  it('takes a session; a follow belongs to somebody', async () => {
    await anonymous().put(`/v1/follows/${published.id}`).expect(401);
    await anonymous().get('/v1/follows').expect(401);
  });
});
