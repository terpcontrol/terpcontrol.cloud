import { anonymous, createAccount, Session, unique } from '../support/api';
import { provisionDevice } from '../support/device';
import { remindSpace, storeCameraStill } from '../support/fixtures';

/**
 * What somebody who is not in a diary can read: through its public address, and
 * through a link that was sent to them.
 *
 * Half of this spec is about what does *not* come back. A public read is the one
 * place where a field nobody thought about becomes a stranger reading an e-mail
 * address, a device id or a harvest weight, so each of those is asserted against
 * rather than left to the shape of the answer.
 */

/** A one-pixel JPEG, which is enough for a picture to exist and be served. */
const A_PICTURE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

let owner: Session;
let stranger: Session;
let tent: string;
let deviceId: string;

/** A grow, public by its own address, with a day counter and a camera in its tent. */
let diary: { id: string; slug: string };
let camera: string;

const startAGrow = async (over: Record<string, unknown> = {}) =>
  (
    await owner.client
      .post('/v1/grows')
      .send({ name: 'Public run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 2 }], spaceId: tent, ...over })
      .expect(201)
  ).body;

const linkOnto = async (subject: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  (
    await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject, ...over })
      .expect(201)
  ).body;

beforeAll(async () => {
  owner = await createAccount('public-owner');
  stranger = await createAccount('public-stranger');

  const device = await provisionDevice(owner, 'controller');
  deviceId = device.deviceId;
  tent = (await owner.client.get(`/v1/devices/${deviceId}`).expect(200)).body.spaceId;

  camera = (await owner.client.post('/v1/cameras').send({ kind: 'rtsp', spaceId: tent, name: 'Canopy', url: 'rtsp://10.0.0.30:554/s' }).expect(201))
    .body.id;

  diary = await startAGrow();
  await owner.client.post(`/v1/grows/${diary.id}/phases`).send({ stage: 'flowering' }).expect(201);
  await owner.client.patch(`/v1/grows/${diary.id}`).send({ visibility: 'public' }).expect(200);
});

describe('a public grow at its own address', () => {
  it('answers the diary, and says the window it was read through', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);

    expect(page.body).toMatchObject({ slug: diary.slug, name: 'Public run', type: 'photoperiod', stage: 'flowering', dayNumber: 1 });
    expect(page.body.author.handle).toEqual(expect.any(String));
    expect(page.body.weeks.length).toBeGreaterThan(0);
    expect(page.body.totals).toMatchObject({ entryCount: expect.any(Number) });
    // A public grow is readable for as long as it ran, and no further.
    expect(page.body.range.startsAt).toEqual(expect.any(String));
    expect(page.body.includeCameras).toBe(true);
  });

  it('names nobody: no owner id, no e-mail, no real name', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);
    const body = JSON.stringify(page.body);

    expect(page.body).not.toHaveProperty('ownerId');
    expect(body).not.toContain(owner.userId);
    expect(body).not.toContain(owner.username);
    expect(body).not.toMatch(/@test\.invalid/);

    // The diary's lines are there; who wrote each of them is not, which is why
    // a public page carries no `people` list to look one up in.
    const lines = page.body.weeks.flatMap((week: { entries: unknown[] }) => week.entries);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line: { authorId: string | null }) => line.authorId === null)).toBe(true);
    // The owner still reads their own diary with the author on every line.
    const mine = await owner.client.get(`/v1/grows/${diary.id}/weeks`).expect(200);
    expect(mine.body.items[0].entries[0].authorId).toBe(owner.userId);
  });

  it('names no device the diary was not kept with', async () => {
    // A second tent of the same account, which this grow never stood in.
    const elsewhere = await provisionDevice(owner, 'fridge');

    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);
    expect(JSON.stringify(page.body)).not.toContain(elsewhere.deviceId);
  });

  it('is not there while it is private, and nor is a slug nobody has', async () => {
    const hidden = await startAGrow({ name: 'Kept quiet' });

    const refused = await anonymous().get(`/v1/public/grows/${hidden.slug}`).expect(404);
    expect(refused.body.code).toBe('grow_not_found');

    await anonymous().get('/v1/public/grows/no-such-diary').expect(404);
  });

  it('hides the weights and the counts its owner asked to hide', async () => {
    const shy = await createAccount('public-shy');
    await shy.client
      .patch('/v1/me')
      .send({ privacy: { hideWeights: true, hideCounts: true } })
      .expect(200);

    const theirs = (
      await shy.client
        .post('/v1/grows')
        .send({ name: 'Quiet numbers', type: 'autoflower', plants: [{ strain: 'Gelato', count: 3 }] })
        .expect(201)
    ).body;
    await shy.client.post(`/v1/grows/${theirs.id}/phases`).send({ stage: 'drying' }).expect(201);
    await shy.client.patch(`/v1/grows/${theirs.id}`).send({ visibility: 'public' }).expect(200);

    const plants = await shy.client.get(`/v1/grows/${theirs.id}/plants`).expect(200);
    await shy.client
      .patch(`/v1/plants/${plants.body.items[0].id}`)
      .send({ harvest: { harvestedAt: new Date().toISOString(), wetWeightG: 420, dryWeightG: 96 } })
      .expect(200);

    const page = await anonymous().get(`/v1/public/grows/${theirs.slug}`).expect(200);
    expect(page.body.plantCount).toBeNull();
    expect(page.body.harvest).toMatchObject({ wetWeightG: null, dryWeightG: null });
    expect(JSON.stringify(page.body)).not.toContain('420');
  });
});

describe('a picture of a public grow', () => {
  it('serves a still of the camera that watched it', async () => {
    const mediaId = await storeCameraStill(camera, A_PICTURE, new Date());

    const served = await anonymous().get(`/v1/public/grows/${diary.slug}/media/${mediaId}`).expect(200);
    expect(served.headers['content-type']).toMatch(/^image\//);

    // The same bytes through the route that asks for a session are nobody's: a
    // still belongs to a camera, and a camera is not public.
    await anonymous().get(`/v1/media/${mediaId}/content`).expect(404);
  });

  it('refuses a picture of another tent, however public this diary is', async () => {
    const otherTent = (
      await owner.client
        .post('/v1/spaces')
        .send({ kind: 'tent', name: unique('elsewhere') })
        .expect(201)
    ).body.id;
    const otherCamera = (
      await owner.client.post('/v1/cameras').send({ kind: 'rtsp', spaceId: otherTent, name: 'Elsewhere', url: 'rtsp://10.0.0.31:554/s' }).expect(201)
    ).body.id;

    const elsewhere = await storeCameraStill(otherCamera, A_PICTURE, new Date());
    await anonymous().get(`/v1/public/grows/${diary.slug}/media/${elsewhere}`).expect(404);
  });
});

describe('the card and the shell', () => {
  it('draws a PNG of the size every scraper crops to', async () => {
    const card = await anonymous().get(`/v1/public/grows/${diary.slug}/card.png`).expect(200);

    expect(card.headers['content-type']).toBe('image/png');
    expect(card.body.length).toBeGreaterThan(1000);
    // The PNG header states the dimensions in bytes 16..24 of the IHDR chunk.
    expect(card.body.readUInt32BE(16)).toBe(1200);
    expect(card.body.readUInt32BE(20)).toBe(630);
  });

  it('answers the shareable address with tags that point at that same card', async () => {
    const shell = await anonymous().get(`/g/${diary.slug}`).expect(200);

    expect(shell.headers['content-type']).toMatch(/text\/html/);
    expect(shell.text).toContain('<meta property="og:title" content="Public run">');
    expect(shell.text).toContain(`/v1/public/grows/${diary.slug}/card.png`);
    expect(shell.text).toContain(`/g/${diary.slug}`);
    expect(shell.text).toContain('twitter:card');
  });

  it('escapes what somebody typed rather than putting it into the markup', async () => {
    const nasty = await startAGrow({ name: 'Sneaky "<script>alert(1)</script>"' });
    await owner.client.patch(`/v1/grows/${nasty.id}`).send({ visibility: 'public' }).expect(200);

    const shell = await anonymous().get(`/g/${nasty.slug}`).expect(200);
    expect(shell.text).not.toContain('<script>');
    expect(shell.text).toContain('&lt;script&gt;');
  });
});

describe('a public profile', () => {
  let author: Session;
  let handle: string;

  beforeAll(async () => {
    author = await createAccount('public-author');
    handle = (await author.client.get('/v1/me').expect(200)).body.handle;
  });

  it('is not there until its owner publishes one', async () => {
    const refused = await anonymous().get(`/v1/public/users/${handle}`).expect(404);
    expect(refused.body.code).toBe('user_not_found');

    await anonymous().get(`/@${handle}`).expect(404);
  });

  it('lists the public diaries and no others, and says nothing else about the account', async () => {
    await author.client.patch('/v1/me').send({ publicProfile: true, bio: 'Two tents and a fridge.' }).expect(200);

    const open = (await author.client.post('/v1/grows').send({ name: 'Shown', type: 'autoflower', plants: [] }).expect(201)).body;
    await author.client.patch(`/v1/grows/${open.id}`).send({ visibility: 'public' }).expect(200);
    await author.client.post('/v1/grows').send({ name: 'Hidden', type: 'autoflower', plants: [] }).expect(201);

    const page = await anonymous().get(`/v1/public/users/${handle}`).expect(200);

    expect(page.body.author).toEqual({ handle, bio: 'Two tents and a fridge.', avatarMediaId: null });
    expect(page.body.grows.map((card: { name: string }) => card.name)).toEqual(['Shown']);

    const body = JSON.stringify(page.body);
    expect(body).not.toContain(author.userId);
    expect(body).not.toContain(author.username);

    const shell = await anonymous().get(`/@${handle}`).expect(200);
    expect(shell.text).toContain(`<meta property="og:title" content="@${handle}">`);
    expect(shell.text).toContain(`/v1/public/users/${handle}/card.png`);

    const card = await anonymous().get(`/v1/public/users/${handle}/card.png`).expect(200);
    expect(card.headers['content-type']).toBe('image/png');
  });
});

describe('opening a share link', () => {
  it('answers what the token leads to and never the link itself', async () => {
    const link = await linkOnto({ type: 'grow', id: diary.id });

    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    expect(opened.body).toMatchObject({ kind: 'view', includeCameras: false, expiresAt: null });
    expect(opened.body.subject.type).toBe('grow');
    expect(opened.body.subject.grow.slug).toBe(diary.slug);

    // The counters, the author and the token are the owner's business.
    expect(opened.body).not.toHaveProperty('token');
    expect(opened.body).not.toHaveProperty('createdBy');
    expect(opened.body).not.toHaveProperty('state');
    expect(JSON.stringify(opened.body)).not.toContain(link.token);
  });

  it('counts the opening, which is the owner´s only sign that a link is read', async () => {
    const link = await linkOnto({ type: 'grow', id: diary.id });

    await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    const listed = await owner.client.get('/v1/share-links?limit=200').expect(200);
    const mine = listed.body.items.find((one: { id: string }) => one.id === link.id);

    expect(mine.state.openCount).toBe(2);
    expect(mine.state.lastOpenedAt).toEqual(expect.any(String));
  });

  it('leads nowhere once it has expired, exactly as a token nobody issued does', async () => {
    const link = await linkOnto({ type: 'grow', id: diary.id }, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const refused = await anonymous().get(`/v1/shared/${link.token}`).expect(404);
    expect(refused.body.code).toBe('share_link_not_found');

    await anonymous().get('/v1/shared/a-token-nobody-ever-issued').expect(404);
  });

  it('clamps the diary to the window it carries, even on a grow that is public anyway', async () => {
    // A window that closed before the grow began. The grow is public, so the
    // link could have been granted its whole life; the link's own end is what
    // the answer is clamped to instead.
    const closedAt = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
    const link = await linkOnto({ type: 'grow', id: diary.id }, { range: { startsAt: null, endsAt: closedAt } });

    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    expect(opened.body.range.endsAt).toBe(closedAt);
    expect(opened.body.subject.grow.range.endsAt).toBe(closedAt);
    expect(opened.body.subject.grow.weeks).toEqual([]);
    expect(opened.body.subject.grow.totals.entryCount).toBe(0);

    // And a link that asks for more than the page has does not get more: the
    // window is still the life of the grow.
    const wide = await linkOnto(
      { type: 'grow', id: diary.id },
      { range: { startsAt: closedAt, endsAt: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString() } },
    );
    const open = await anonymous().get(`/v1/shared/${wide.token}`).expect(200);

    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);
    expect(open.body.range.startsAt).toBe(page.body.range.startsAt);
    expect(new Date(open.body.range.endsAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('carries no camera picture unless it was made to', async () => {
    const mediaId = await storeCameraStill(camera, A_PICTURE, new Date());
    const closed = await linkOnto({ type: 'space', id: tent });

    const opened = await anonymous().get(`/v1/shared/${closed.token}`).expect(200);
    expect(opened.body.includeCameras).toBe(false);
    expect(opened.body.subject.space.cameras).toEqual([]);

    await anonymous().get(`/v1/media/${mediaId}/content?share=${closed.token}`).expect(404);

    // The same link made to carry them reaches the same picture.
    const open = await linkOnto({ type: 'space', id: tent }, { includeCameras: true });
    const withCameras = await anonymous().get(`/v1/shared/${open.token}`).expect(200);

    expect(withCameras.body.includeCameras).toBe(true);
    expect(withCameras.body.subject.space.cameras.length).toBeGreaterThan(0);
    await anonymous().get(`/v1/media/${mediaId}/content?share=${open.token}`).expect(200);
  });

  it('opens a tent without the working half of its page', async () => {
    await remindSpace(tent, owner.userId);

    const mine = await owner.client.get(`/v1/spaces/${tent}/overview`).expect(200);
    expect(mine.body.dueTasks.length).toBeGreaterThan(0);

    const link = await linkOnto({ type: 'space', id: tent });
    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    // What is due and what is alarming is for whoever keeps the tent.
    expect(opened.body.subject.space.dueTasks).toEqual([]);
    expect(opened.body.subject.space.openAlerts).toEqual([]);
    expect(opened.body.subject.space.spaceId).toBe(tent);
  });

  it('reads the same however the person holding it is signed in', async () => {
    const link = await linkOnto({ type: 'grow', id: diary.id });

    const asStranger = await stranger.client.get(`/v1/shared/${link.token}`).expect(200);
    const asOwner = await owner.client.get(`/v1/shared/${link.token}`).expect(200);

    expect(asOwner.body.subject.grow.slug).toBe(asStranger.body.subject.grow.slug);
    expect(asOwner.body.includeCameras).toBe(asStranger.body.includeCameras);
  });
});
