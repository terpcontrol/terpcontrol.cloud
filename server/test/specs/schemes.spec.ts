import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { claimCodeOf, registerDevice } from '../support/device';
import { shareLinkOnGrow } from '../support/fixtures';

/**
 * The feeding schemes somebody keeps of their own.
 *
 * Two things are worth asserting over HTTP. The first is that a scheme is
 * nobody's but its owner's: it stands in no space and belongs to no grow, so
 * none of the ways into somebody else's data - a share link, a public diary, the
 * demo tour - reaches one, and what the list hands out has to stay right on the
 * second page as well as the first.
 *
 * The second is the promise the whole arrangement rests on. A grow keeps its own
 * copy of the grid, so editing a scheme here must leave every grow already
 * running exactly as it was. That is what lets a scheme be edited at all, and it
 * is checked against the grow rather than reasoned about.
 */

let owner: Session;
let stranger: Session;
let admin: Session;
let tent: string;

const A_GRID = [
  { week: 1, stage: 'vegetative', amounts: [{ productKey: 'bio-grow', name: 'Bio·Grow', value: 2, unit: 'ml/l' }] },
  { week: 2, stage: 'flowering', amounts: [{ productKey: 'bio-bloom', name: 'Bio·Bloom', value: 4, unit: 'ml/l' }] },
];

const aScheme = (over: Record<string, unknown> = {}) => ({ name: unique('House mix'), grid: A_GRID, ...over });

const create = async (session: Session, body: Record<string, unknown> = aScheme()) =>
  (await session.client.post('/v1/schemes').send(body).expect(201)).body;

beforeAll(async () => {
  owner = await createAccount('schemes-owner');
  stranger = await createAccount('schemes-stranger');
  admin = await loginAsAdmin();

  const device = await registerDevice('controller');
  const claimed = await owner.client
    .post('/v1/devices/claims')
    .send({ code: await claimCodeOf(device.deviceId) })
    .expect(201);
  tent = claimed.body.device.spaceId;
});

describe('keeping a scheme', () => {
  it('stores the grid as it was written and says it came from nowhere', async () => {
    const written = await create(owner, aScheme({ name: 'From scratch' }));

    expect(written).toMatchObject({ ownerId: owner.userId, name: 'From scratch', origin: { assetId: null, version: null } });
    expect(written.grid).toEqual(A_GRID);
    expect(written.createdAt).toEqual(expect.any(String));
  });

  it('remembers which shipped asset it was taken from, without reading one', async () => {
    const written = await create(owner, aScheme({ origin: { assetId: 'biobizz-light-mix', version: 'v2024-03' } }));

    expect(written.origin).toEqual({ assetId: 'biobizz-light-mix', version: 'v2024-03' });
  });

  it('renames without being handed the grid again', async () => {
    const written = await create(owner);
    const renamed = await owner.client.patch(`/v1/schemes/${written.id}`).send({ name: 'Spring mix' }).expect(200);

    expect(renamed.body).toMatchObject({ id: written.id, name: 'Spring mix' });
    expect(renamed.body.grid).toEqual(A_GRID);
  });

  it('saves a grid whole, so a week taken out of the table is a week no longer fed', async () => {
    const written = await create(owner);
    const shortened = await owner.client
      .patch(`/v1/schemes/${written.id}`)
      .send({ grid: [A_GRID[0]] })
      .expect(200);

    expect(shortened.body.grid).toEqual([A_GRID[0]]);
  });

  it('throws one away', async () => {
    const written = await create(owner);

    await owner.client.delete(`/v1/schemes/${written.id}`).expect(204);
    await owner.client.patch(`/v1/schemes/${written.id}`).send({ name: 'Back' }).expect(404);
  });
});

describe('a grow already started', () => {
  it('is left exactly as it was when the scheme it came from is edited', async () => {
    const scheme = await create(owner, aScheme({ origin: { assetId: 'biobizz-light-mix', version: 'v2024-03' } }));
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({
          name: unique('Spring run'),
          type: 'photoperiod',
          plants: [{ strain: 'Amnesia', count: 2 }],
          spaceId: tent,
          scheme: {
            origin: { type: 'own', schemeId: scheme.id },
            strength: 1,
            waterEc: 0.4,
            plantType: 'soil',
            flipWeek: 4,
            edited: false,
            grid: A_GRID,
          },
        })
        .expect(201)
    ).body;

    await owner.client
      .patch(`/v1/schemes/${scheme.id}`)
      .send({ name: 'Rewritten', grid: [{ week: 1, stage: 'flowering', amounts: [] }] })
      .expect(200);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.scheme.grid).toEqual(A_GRID);
    expect(read.body.scheme.origin).toEqual({ type: 'own', schemeId: scheme.id });
  });

  it('goes on being fed the same way after the scheme is deleted', async () => {
    const scheme = await create(owner);
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({
          name: unique('Autumn run'),
          type: 'photoperiod',
          plants: [{ strain: 'Gelato', count: 1 }],
          scheme: {
            origin: { type: 'own', schemeId: scheme.id },
            strength: 1,
            waterEc: 0.4,
            plantType: 'soil',
            flipWeek: null,
            edited: false,
            grid: A_GRID,
          },
        })
        .expect(201)
    ).body;

    await owner.client.delete(`/v1/schemes/${scheme.id}`).expect(204);

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.scheme.grid).toEqual(A_GRID);
  });
});

describe('whose scheme it is', () => {
  let mine: Record<string, unknown>;

  beforeAll(async () => {
    mine = await create(owner, aScheme({ name: unique('Only mine') }));
  });

  it('is missing from a stranger, who cannot list it, change it or delete it', async () => {
    const theirs = await stranger.client.get('/v1/schemes').expect(200);
    expect(theirs.body.items.map((row: { id: string }) => row.id)).not.toContain(mine.id);

    await stranger.client.patch(`/v1/schemes/${mine.id}`).send({ name: 'Taken' }).expect(404);
    await stranger.client.delete(`/v1/schemes/${mine.id}`).expect(404);
  });

  it('is not reached by a share link on a grow of the same owner', async () => {
    const token = unique('schemetoken').replace(/-/g, '');
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({ name: unique('Shared run'), type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }] })
        .expect(201)
    ).body;
    await shareLinkOnGrow(grow.id, token);

    // The link is live - it opens the diary of the grow it names - and reaches
    // nothing beside it: a scheme is not a subject `access()` decides about, so
    // there is no window onto one at all.
    await anonymous().get(`/v1/entries?growId=${grow.id}`).set('X-Share-Token', token).expect(200);
    await anonymous().get('/v1/schemes').set('X-Share-Token', token).expect(401);
    await anonymous().patch(`/v1/schemes/${mine.id}`).set('X-Share-Token', token).send({ name: 'Taken' }).expect(401);
  });

  it('is not reached without a session at all', async () => {
    await anonymous().get('/v1/schemes').expect(401);
    await anonymous().post('/v1/schemes').send(aScheme()).expect(401);
  });

  it('leaves the demo tour with none, and lets it write none', async () => {
    const demo = await demoSession();

    const listed = await demo.client.get('/v1/schemes').expect(200);
    expect(listed.body.items).toEqual([]);
    await demo.client.post('/v1/schemes').send(aScheme()).expect(403);
  });
});

describe('the list', () => {
  it('holds the visibility filter on every page, not only the first', async () => {
    const shelf = await createAccount('schemes-shelf');
    for (let made = 0; made < 3; made += 1) await create(shelf);
    await create(owner, aScheme({ name: unique('Not theirs') }));

    const first = await shelf.client.get('/v1/schemes?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await shelf.client.get(`/v1/schemes?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`).expect(200);
    const seen = [...first.body.items, ...second.body.items];

    expect(seen).toHaveLength(3);
    expect(seen.every((row: { ownerId: string }) => row.ownerId === shelf.userId)).toBe(true);
  });

  it('is newest first', async () => {
    const shelf = await createAccount('schemes-order');
    const older = await create(shelf, aScheme({ name: 'Older' }));
    const newer = await create(shelf, aScheme({ name: 'Newer' }));

    const listed = await shelf.client.get('/v1/schemes').expect(200);
    expect(listed.body.items.map((row: { id: string }) => row.id)).toEqual([newer.id, older.id]);
  });
});

describe('an admin', () => {
  it('reaches a scheme, because an admin reaches everything', async () => {
    const written = await create(owner, aScheme({ name: unique('Reachable') }));
    const renamed = await admin.client.patch(`/v1/schemes/${written.id}`).send({ name: 'Renamed by an admin' }).expect(200);

    expect(renamed.body.name).toBe('Renamed by an admin');
  });

  /**
   * Reaching one named scheme and being handed everybody's shelf are different
   * things. The listing is what "Me - Feeding schemes" draws, so it answers the
   * administrator as the person whose page it is.
   */
  it('is listed their own schemes and not the install´s', async () => {
    const theirs = await create(owner, aScheme({ name: unique('Nobody else´s') }));

    const listed = (await admin.client.get('/v1/schemes?limit=200').expect(200)).body.items;

    expect(listed.map((row: { id: string }) => row.id)).not.toContain(theirs.id);
  });
});
