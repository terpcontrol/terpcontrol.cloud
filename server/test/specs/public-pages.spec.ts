import { anonymous, createAccount, Session, unique } from '../support/api';
import { seedMeasurements } from '../support/control';
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

    expect(page.body).toMatchObject({ slug: diary.slug, name: 'Public run', type: 'photoperiod', stage: 'flowering', dayNumber: 1, stageWeek: 1 });
    expect(page.body.author.handle).toEqual(expect.any(String));
    expect(page.body.weeks.length).toBeGreaterThan(0);
    expect(page.body.totals).toMatchObject({ entryCount: expect.any(Number) });
    // A public grow is readable for as long as it ran, and no further.
    expect(page.body.range.startsAt).toEqual(expect.any(String));
    expect(page.body.includeCameras).toBe(true);
  });

  it('says which week of the stage it is in, and nothing else of what the owner is told about the phases', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);

    // The line above the cards names the stage, so the week beside it is the
    // stage's; the grow's own week is the cards' heading.
    expect(page.body.stageWeek).toBe(1);
    expect(page.body.weeks[0].stageWeek).toBe(page.body.stageWeek);

    // One figure and no more: when each phase began, how many days of it have
    // gone by, which plants are in which of them and where they stand are the
    // owner's business, and none of them travel with it.
    for (const field of ['phases', 'summary', 'phaseDay', 'weekNumber', 'groups', 'locations', 'isAuto', 'spaceId']) {
      expect(page.body).not.toHaveProperty(field);
    }
  });

  it('counts a picture the diary carries on a line of any kind, not only on a line called a photo', async () => {
    const before = (await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200)).body.totals.photoCount;

    const picture = (
      await owner.client.post('/v1/media').field('kind', 'photo').field('growId', diary.id).attach('file', A_PICTURE, 'leaf.jpg').expect(201)
    ).body;
    await owner.client
      .post('/v1/entries')
      .send({ kind: 'note', growId: diary.id, text: 'The two in front', mediaIds: [picture.id], values: { kind: 'note' } })
      .expect(201);

    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);

    expect(page.body.totals.photoCount).toBe(before + 1);
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

  it('names the grow itself, which is what a reader follows, and never a diary that has no public page', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);
    // The same id the author's own profile already lists for a public diary.
    expect(page.body.growId).toBe(diary.id);

    // A link onto a diary its owner never published is a window and nothing
    // more: there is no page behind it to follow, so there is no id either.
    const unpublished = await startAGrow({ name: 'Sent to one person' });
    const link = await linkOnto({ type: 'grow', id: unpublished.id });

    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    expect(opened.body.subject.grow.growId).toBeNull();
    expect(JSON.stringify(opened.body)).not.toContain(unpublished.id);
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
    // As a whole number rather than as a substring: the page is full of ids,
    // and three digits turn up inside a uuid often enough to fail on a Tuesday.
    expect(JSON.stringify(page.body)).not.toMatch(/\b420\b/);
  });
});

describe('a public diary longer than one page of weeks', () => {
  /** Thirty-two weeks, which is what a real photoperiod run under lights comes to and more than a page holds. */
  const A_LONG_RUN_DAYS = 218;

  let long: { id: string; slug: string };

  beforeAll(async () => {
    long = await startAGrow({
      name: 'The long one',
      startedAt: new Date(Date.now() - A_LONG_RUN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      spaceId: null,
    });
    await owner.client.patch(`/v1/grows/${long.id}`).send({ visibility: 'public' }).expect(200);
  });

  it('says with a cursor that there are earlier weeks, and answers every one of them', async () => {
    const page = await anonymous().get(`/v1/public/grows/${long.slug}`).expect(200);

    expect(page.body.weeks).toHaveLength(26);
    expect(page.body.weeksCursor).toEqual(expect.any(String));

    const earlier = await anonymous().get(`/v1/public/grows/${long.slug}/weeks?cursor=${page.body.weeksCursor}`).expect(200);
    const numbers = [...page.body.weeks, ...earlier.body.items].map((week: { weekNumber: number }) => week.weekNumber);

    // Every week the grow lived, newest first and each of them once: the first
    // day of a long diary has an address like any other day of it.
    expect(numbers[0]).toBe(32);
    expect(numbers[numbers.length - 1]).toBe(1);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(earlier.body.nextCursor).toBeNull();
  });

  it('carries no cursor where the diary fits on its page', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);

    expect(page.body.weeksCursor).toBeNull();
    const weeks = await anonymous().get(`/v1/public/grows/${diary.slug}/weeks`).expect(200);
    expect(weeks.body.nextCursor).toBeNull();
  });

  it('gives a stranger nothing on those weeks the page itself would not have', async () => {
    const weeks = await anonymous().get(`/v1/public/grows/${long.slug}/weeks`).expect(200);
    const body = JSON.stringify(weeks.body);

    // The owner's own route names who wrote each line and answers a `people`
    // list to look them up in; neither is a stranger's, on the first page of
    // weeks or on the twentieth.
    expect(weeks.body).not.toHaveProperty('people');
    expect(body).not.toContain(owner.userId);
    expect(body).not.toContain(deviceId);
    const lines: { authorId: string | null }[] = weeks.body.items.flatMap((week: { entries: { authorId: string | null }[] }) => week.entries);
    expect(lines.every(line => line.authorId === null)).toBe(true);
  });

  it('is not there for a diary that is not public, whatever its slug', async () => {
    const hidden = await startAGrow({ name: 'Kept quiet too' });

    const refused = await anonymous().get(`/v1/public/grows/${hidden.slug}/weeks`).expect(404);
    expect(refused.body.code).toBe('grow_not_found');
  });

  it('reads the same way through a link, and a link onto a tent has no weeks at all', async () => {
    const link = await linkOnto({ type: 'grow', id: long.id });
    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    expect(opened.body.subject.grow.weeksCursor).toEqual(expect.any(String));
    const earlier = await anonymous().get(`/v1/shared/${link.token}/weeks?cursor=${opened.body.subject.grow.weeksCursor}`).expect(200);
    expect(earlier.body.items.map((week: { weekNumber: number }) => week.weekNumber)).toContain(1);

    const ontoTheTent = await linkOnto({ type: 'space', id: tent });
    await anonymous().get(`/v1/shared/${ontoTheTent.token}/weeks`).expect(404);
  });

  it('carries a link no further back than the window the link itself was given', async () => {
    const from = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const link = await linkOnto({ type: 'grow', id: long.id }, { range: { startsAt: from.toISOString(), endsAt: null } });

    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    // Three weeks of a thirty-two week grow, and nothing earlier to ask for:
    // the second route is granted exactly what the first one was.
    expect(opened.body.subject.grow.weeksCursor).toBeNull();

    const weeks = await anonymous().get(`/v1/shared/${link.token}/weeks`).expect(200);
    expect(weeks.body.items.length).toBeLessThan(6);
    expect(weeks.body.items.every((week: { startsAt: string }) => Date.parse(week.startsAt) >= from.getTime())).toBe(true);
    expect(weeks.body.nextCursor).toBeNull();
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

  it('says of a diary that has ended that it has, wherever that card is listed', async () => {
    const author = await createAccount('public-finished');
    await author.client.patch('/v1/me').send({ publicProfile: true }).expect(200);

    const over = (
      await author.client
        .post('/v1/grows')
        .send({ name: 'Finished', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }] })
        .expect(201)
    ).body;
    const endedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await author.client.patch(`/v1/grows/${over.id}`).send({ visibility: 'public', endedAt }).expect(200);

    const running = (
      await author.client
        .post('/v1/grows')
        .send({ name: 'Still going', type: 'photoperiod', plants: [{ strain: 'Gelato', count: 1 }] })
        .expect(201)
    ).body;
    await author.client.patch(`/v1/grows/${running.id}`).send({ visibility: 'public' }).expect(200);

    const handle = (await author.client.get('/v1/me').expect(200)).body.handle;
    const profile = await anonymous().get(`/v1/public/users/${handle}`).expect(200);

    // The card's own date is when the diary last moved, which says nothing
    // about an end; without this field the two cards read alike.
    const cards: Record<string, string | null> = Object.fromEntries(
      profile.body.grows.map((card: { name: string; endedAt: string | null }) => [card.name, card.endedAt]),
    );
    expect(cards).toEqual({ Finished: endedAt, 'Still going': null });
  });

  it('dates a card by the newest line in its diary, and opens on the diary with the newest one', async () => {
    const quiet = (await author.client.post('/v1/grows').send({ name: 'Quiet', type: 'autoflower', plants: [] }).expect(201)).body;
    await author.client.patch(`/v1/grows/${quiet.id}`).send({ visibility: 'public' }).expect(200);

    const shown = (await anonymous().get(`/v1/public/users/${handle}`).expect(200)).body.grows.find(
      (card: { name: string }) => card.name === 'Shown',
    );
    const written = (
      await author.client
        .post('/v1/entries')
        .send({ kind: 'note', growId: shown.growId, text: 'Topped', values: { kind: 'note' } })
        .expect(201)
    ).body;

    const page = await anonymous().get(`/v1/public/users/${handle}`).expect(200);

    // The line, not the moment either grow's row was last saved - both were
    // written after it, and the quiet one was written last.
    expect(page.body.grows[0]).toMatchObject({ name: 'Shown', updatedAt: written.occurredAt });
    expect(page.body.grows.map((card: { name: string }) => card.name)).toEqual(['Shown', 'Quiet']);
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

  /**
   * At most one write a minute per link. The route is anonymous, so a write per
   * read is a write per request from anybody at all; a minute's resolution says
   * the same thing to the owner and bounds the writes by the number of links.
   */
  it('counts the opening, which is the owner´s only sign that a link is read', async () => {
    const link = await linkOnto({ type: 'grow', id: diary.id });

    await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    const listed = await owner.client.get('/v1/share-links?limit=200').expect(200);
    const mine = listed.body.items.find((one: { id: string }) => one.id === link.id);

    expect(mine.state.openCount).toBe(1);
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

  it('shows the pictures it was made to show, which is the whole point of the switch', async () => {
    const mediaId = await storeCameraStill(camera, A_PICTURE, new Date());

    const shut = await linkOnto({ type: 'grow', id: diary.id });
    const open = await linkOnto({ type: 'grow', id: diary.id }, { includeCameras: true });

    // A still names no grow - it belongs to the camera - so a link onto the
    // grow used to reach none of the pictures its own week cards point at.
    await anonymous().get(`/v1/media/${mediaId}/content?share=${open.token}`).expect(200);
    await anonymous().get(`/v1/media/${mediaId}/content?share=${shut.token}`).expect(404);
    // And none of them without a link at all, however public the diary is.
    await anonymous().get(`/v1/media/${mediaId}/content`).expect(404);
  });
});

/**
 * The window belongs to the link and not to the grow: a reader inside one must
 * not be able to learn anything dated outside it. The day number, the stage,
 * the harvest and whether the grow is over are all facts with a date on them,
 * and a link whose window closed in the spring used to answer every one of them
 * as of today.
 */
describe('a diary read through a window that has closed', () => {
  const DAY_MS = 24 * 3600 * 1000;
  const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

  let longRun: { id: string; slug: string };
  let closed: { token: string };

  beforeAll(async () => {
    longRun = (
      await owner.client
        .post('/v1/grows')
        .send({
          name: 'Long run',
          type: 'photoperiod',
          startedAt: daysAgo(60).toISOString(),
          plants: [{ strain: 'Amnesia', count: 2 }],
          spaceId: tent,
        })
        .expect(201)
    ).body;

    await owner.client
      .post(`/v1/grows/${longRun.id}/phases`)
      .send({ stage: 'vegetative', startedAt: daysAgo(60).toISOString() })
      .expect(201);
    // Entered long after the window below closed.
    await owner.client
      .post(`/v1/grows/${longRun.id}/phases`)
      .send({ stage: 'flowering', startedAt: daysAgo(5).toISOString() })
      .expect(201);

    const plants = await owner.client.get(`/v1/grows/${longRun.id}/plants`).expect(200);
    await owner.client
      .patch(`/v1/plants/${plants.body.items[0].id}`)
      .send({ harvest: { harvestedAt: daysAgo(2).toISOString(), wetWeightG: 511, dryWeightG: 117 } })
      .expect(200);

    await owner.client.patch(`/v1/grows/${longRun.id}`).send({ visibility: 'public' }).expect(200);

    closed = await linkOnto({ type: 'grow', id: longRun.id }, { range: { startsAt: null, endsAt: daysAgo(30).toISOString() } });
  });

  it('counts the days up to the window and names the stage the grow was in then', async () => {
    const seen = (await anonymous().get(`/v1/shared/${closed.token}`).expect(200)).body.subject.grow;
    const whole = await anonymous().get(`/v1/public/grows/${longRun.slug}`).expect(200);

    expect(whole.body.dayNumber).toBeGreaterThan(55);
    expect(whole.body.stage).toBe('flowering');

    // Thirty days in, and still in the phase it was in thirty days ago.
    expect(seen.dayNumber).toBeGreaterThanOrEqual(30);
    expect(seen.dayNumber).toBeLessThanOrEqual(32);
    expect(seen.stage).toBe('vegetative');
  });

  it('counts the week of the stage up to the window too, and of the stage the window ends in', async () => {
    const seen = (await anonymous().get(`/v1/shared/${closed.token}`).expect(200)).body.subject.grow;
    const whole = (await anonymous().get(`/v1/public/grows/${longRun.slug}`).expect(200)).body;

    // Flowering began five days ago, so the diary is in its first or second
    // week of it - nothing like the ninth week of the grow the day counter is
    // on, which is the figure the page used to draw beside the stage.
    expect(whole.stageWeek).toBeLessThanOrEqual(2);
    expect(Math.floor((whole.dayNumber - 1) / 7) + 1).toBeGreaterThan(7);

    // The reader inside the closed window is in vegetative, which began on day
    // one, so there the stage week and the grow week are the same figure.
    expect(seen.stageWeek).toBe(Math.floor((seen.dayNumber - 1) / 7) + 1);
  });

  it('states no harvest at all, because it happened after the reader´s window', async () => {
    const seen = (await anonymous().get(`/v1/shared/${closed.token}`).expect(200)).body.subject.grow;
    const whole = await anonymous().get(`/v1/public/grows/${longRun.slug}`).expect(200);

    expect(whole.body.harvest).toMatchObject({ harvestedAt: expect.any(String) });
    expect(seen.harvest).toBeNull();
    expect(seen.endedAt).toBeNull();
    expect(JSON.stringify(seen)).not.toMatch(/\b511\b/);
  });

  it('carries no week that lies wholly outside the window, and no day of one that half does', async () => {
    const narrow = await linkOnto(
      { type: 'grow', id: longRun.id },
      { range: { startsAt: daysAgo(31).toISOString(), endsAt: daysAgo(30).toISOString() } },
    );

    const seen = (await anonymous().get(`/v1/shared/${narrow.token}`).expect(200)).body.subject.grow;

    expect(seen.weeks).toHaveLength(1);
    // The card states the day it was given, not the seven the week is of.
    const [week] = seen.weeks;
    expect(new Date(week.startsAt).getTime()).toBeGreaterThanOrEqual(daysAgo(31).getTime() - 1000);
    expect(new Date(week.endsAt).getTime()).toBeLessThanOrEqual(daysAgo(30).getTime() + 1000);
  });
});

/**
 * What a public page is not allowed to say about the hardware behind it. There
 * is no takeover path - claiming a device that is claimed is refused - but a
 * device id ties a diary to a named piece of somebody's kit, and a space id and
 * a room id say how their flat is arranged.
 */
describe('what a public page never names', () => {
  it('names no controller on a week card and no space in the report', async () => {
    const page = await anonymous().get(`/v1/public/grows/${diary.slug}`).expect(200);

    expect(page.body.weeks.every((week: { deviceIds: null }) => week.deviceIds === null)).toBe(true);
    expect(JSON.stringify(page.body)).not.toContain(deviceId);
    expect(JSON.stringify(page.body)).not.toContain(tent);

    // The owner reading their own grow is told both. A null is "you are not
    // being told", an empty list "nothing measures where this grow stood" -
    // which is what a simulated controller that has never reported a
    // configuration answers.
    const mine = await owner.client.get(`/v1/grows/${diary.id}/weeks`).expect(200);
    expect(Array.isArray(mine.body.items[0].deviceIds)).toBe(true);

    const report = await owner.client.get(`/v1/grows/${diary.id}/report`).expect(200);
    expect(report.body.phases[0].spaceIds).toEqual([tent]);
  });

  it('names no device and no room on a tent somebody was sent a link to', async () => {
    const link = await linkOnto({ type: 'space', id: tent });
    const opened = await anonymous().get(`/v1/shared/${link.token}`).expect(200);

    expect(opened.body.subject.space).toMatchObject({ deviceIds: null, roomId: null });
    expect(JSON.stringify(opened.body)).not.toContain(deviceId);
  });
});

describe('one line of a shared diary', () => {
  /**
   * A grant reaches the grow rather than each of its lines, and the list route
   * next door has clamped since it was written - so this one handed out every
   * line of a diary, one id at a time, to a link that was sent a fortnight.
   *
   * On a grow that is kept private, which is where a link is the whole of the
   * reader's proof: a public grow is granted its own life to anybody with or
   * without a link, so a narrower window on one would prove nothing here.
   */
  it('is not there where it falls outside the window the link carries', async () => {
    const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const kept = await startAGrow({ name: 'Kept private', startedAt: daysAgo(60) });
    await owner.client
      .post(`/v1/grows/${kept.id}/phases`)
      .send({ stage: 'vegetative', startedAt: daysAgo(60) })
      .expect(201);

    const line = async (days: number, text: string): Promise<string> =>
      (
        await owner.client
          .post('/v1/entries')
          .send({ kind: 'note', growId: kept.id, text, occurredAt: daysAgo(days), values: { kind: 'note' } })
          .expect(201)
      ).body.id;

    const inside = await line(45, 'While the link was watching');
    const outside = await line(20, 'After the window closed');

    const link = await linkOnto({ type: 'grow', id: kept.id }, { range: { startsAt: null, endsAt: daysAgo(30) } });

    await anonymous().get(`/v1/entries/${inside}`).set('X-Share-Token', link.token).expect(200);

    const refused = await anonymous().get(`/v1/entries/${outside}`).set('X-Share-Token', link.token).expect(404);
    expect(refused.body.code).toBe('entry_not_found');

    // The owner reads both, and the list route already agreed.
    await owner.client.get(`/v1/entries/${outside}`).expect(200);
    const listed = await anonymous().get(`/v1/entries?growId=${kept.id}`).set('X-Share-Token', link.token).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).not.toContain(outside);
  });
});

/**
 * The report is the one read of a grow that states the grow as a whole - when it
 * ended, how many days that was, how each phase went - and it answered every one
 * of those from the grow rather than from the window it was read through. A link
 * sent one day of a flowering run was told the run's coldest night, the day the
 * grow came down five months later, and the number of days it lasted.
 */
describe('the report a link reads', () => {
  const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  it('stops where the window does, and states the climate of the window rather than of the phase', async () => {
    const device = await provisionDevice(owner, 'controller');
    // A controller with nothing to aim at is not what a chapter's climate is read
    // from, so the tent is given targets before the run begins.
    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({ configuration: { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 60 } } })
      .expect(200);
    const tentOfIts = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;

    const run = await startAGrow({ name: 'Windowed report', startedAt: daysAgo(60), spaceId: tentOfIts });
    await owner.client
      .post(`/v1/grows/${run.id}/phases`)
      .send({ stage: 'flowering', startedAt: daysAgo(60) })
      .expect(201);
    await owner.client
      .patch(`/v1/grows/${run.id}`)
      .send({ endedAt: daysAgo(5) })
      .expect(200);

    // Mild inside the fortnight the link carries, freezing and soaking outside
    // it - the same phase either way, so only the window can tell them apart.
    const reading = (days: number, temperature: number, humidity: number) => ({
      time: Date.parse(daysAgo(days)),
      device_id: device.deviceId,
      fields: { temperature, humidity, out_light: 1 },
    });
    await seedMeasurements([reading(44, 24, 60), reading(40, 25, 62), reading(36, 24.5, 61), reading(20, 4, 95), reading(10, 39, 12)]);

    const link = await linkOnto({ type: 'grow', id: run.id }, { range: { startsAt: daysAgo(45), endsAt: daysAgo(35) } });
    const read = async (client: { get: (path: string) => any }, extra?: [string, string]) => {
      const call = client.get(`/v1/grows/${run.id}/report`);
      return (await (extra ? call.set(extra[0], extra[1]) : call).expect(200)).body;
    };

    const shared = await read(anonymous(), ['X-Share-Token', link.token]);
    const mine = await read(owner.client);

    // The grow as it stood when the fortnight closed: still running, and as many
    // days old as it was then rather than as it is now.
    expect(shared.endedAt).toBeNull();
    expect(shared.dayCount).toBeLessThan(mine.dayCount);
    expect(shared.dayCount).toBe(26);
    expect(mine.endedAt).toEqual(expect.any(String));

    // One chapter, and it has not ended either - the phase after it, and the day
    // the grow came down, are both dated outside the window.
    expect(shared.phases).toHaveLength(1);
    expect(shared.phases[0]).toMatchObject({ stage: 'flowering', endedAt: null, dayTo: null });
    expect(shared.phases[0].dayCount).toBeLessThan(mine.phases[0].dayCount);

    // And the climate is the fortnight's. The 4 °C night and the 39 °C day are
    // inside the same phase and outside the window, so they are not this
    // reader's to be told about.
    const temperature = shared.phases[0].climate.find((one: { metric: string }) => one.metric === 'temperature');
    expect(temperature.minValue).toBeGreaterThan(20);
    expect(temperature.maxValue).toBeLessThan(30);

    const humidity = shared.phases[0].climate.find((one: { metric: string }) => one.metric === 'humidity');
    expect(humidity.maxValue).toBeLessThan(90);

    // The owner is still told the whole of their own run.
    const ownTemperature = mine.phases[0].climate.find((one: { metric: string }) => one.metric === 'temperature');
    expect(ownTemperature.minValue).toBeLessThan(10);
    expect(ownTemperature.maxValue).toBeGreaterThan(35);
  });

  /**
   * A harvest is dated like any other line. The public page has filtered it by
   * the window since it was written; the report handed over the weight and the
   * day whatever the window said.
   */
  it('has no harvest to state where the plants came down after the window closed', async () => {
    const run = await startAGrow({ name: 'Harvested later', startedAt: daysAgo(60) });
    await owner.client
      .post(`/v1/grows/${run.id}/phases`)
      .send({ stage: 'flowering', startedAt: daysAgo(60) })
      .expect(201);

    await owner.client
      .post(`/v1/grows/${run.id}/harvests`)
      .send({ harvestedAt: daysAgo(10), wetWeightG: 420, dryWeightG: 90 })
      .expect(201);

    const link = await linkOnto({ type: 'grow', id: run.id }, { range: { startsAt: daysAgo(45), endsAt: daysAgo(35) } });
    const shared = (await anonymous().get(`/v1/grows/${run.id}/report`).set('X-Share-Token', link.token).expect(200)).body;

    expect(shared.harvest).toBeNull();
    expect((await owner.client.get(`/v1/grows/${run.id}/report`).expect(200)).body.harvest).toMatchObject({ dryWeightG: 90 });
  });
});

/**
 * These are the only routes anybody at all can call, and none of them is cheap:
 * resolving a link is a database write plus up to twenty-six week cards of
 * time-series reads, and a card is a 1200x630 composite through sharp.
 */
describe('what the public routes cost', () => {
  it('declares a budget on every one of them', async () => {
    const limited = async (path: string): Promise<string | undefined> =>
      (await anonymous().get(path).expect(200)).headers['ratelimit-limit'] as string | undefined;

    const link = await linkOnto({ type: 'grow', id: diary.id });
    const handle = (await owner.client.get('/v1/me').expect(200)).body.handle;
    await owner.client.patch('/v1/me').send({ publicProfile: true }).expect(200);

    expect(await limited(`/v1/shared/${link.token}`)).toEqual(expect.any(String));
    expect(await limited(`/v1/public/grows/${diary.slug}`)).toEqual(expect.any(String));
    expect(await limited(`/v1/public/grows/${diary.slug}/card.png`)).toEqual(expect.any(String));
    expect(await limited(`/v1/public/users/${handle}`)).toEqual(expect.any(String));
    expect(await limited(`/v1/public/users/${handle}/card.png`)).toEqual(expect.any(String));
    expect(await limited(`/g/${diary.slug}`)).toEqual(expect.any(String));
    expect(await limited(`/@${handle}`)).toEqual(expect.any(String));
  });

  it('refuses a caller who spends the budget of one route, and leaves the others alone', async () => {
    const hammer = anonymous();
    const budget = Number(
      (await hammer.get(`/v1/shared/${(await linkOnto({ type: 'grow', id: diary.id })).token}`).expect(200)).headers['ratelimit-limit'],
    );
    const link = await linkOnto({ type: 'grow', id: diary.id });

    let refused = 0;
    for (let attempt = 0; attempt <= budget; attempt += 1) {
      const answer = await hammer.get(`/v1/shared/${link.token}`);
      if (answer.status === 429) refused += 1;
    }

    expect(refused).toBeGreaterThan(0);
    // A burst on one route is not how the rest of the diary is taken down.
    await hammer.get(`/v1/public/grows/${diary.slug}`).expect(200);
  });

  /**
   * The origin stops serving a diary the instant it goes private, but a `public`
   * answer already in a shared cache is out of reach until it expires - so the
   * durations are the window in which a diary that has been taken down can
   * still be fetched by somebody who never held a link.
   */
  it('is cached for minutes rather than for an hour, and the pictures privately', async () => {
    const shortEnough = (header: string | undefined): number => {
      const seconds = Number(/max-age=(\d+)/.exec(header ?? '')?.[1] ?? Number.MAX_SAFE_INTEGER);
      return seconds;
    };

    const card = await anonymous().get(`/v1/public/grows/${diary.slug}/card.png`).expect(200);
    const shell = await anonymous().get(`/g/${diary.slug}`).expect(200);

    expect(shortEnough(card.headers['cache-control'])).toBeLessThanOrEqual(300);
    expect(shortEnough(shell.headers['cache-control'])).toBeLessThanOrEqual(300);

    const mediaId = await storeCameraStill(camera, A_PICTURE, new Date());
    const picture = await anonymous().get(`/v1/public/grows/${diary.slug}/media/${mediaId}`).expect(200);

    // A picture never changes, so a reader's own browser may keep it - but no
    // cache anybody else is served from.
    expect(picture.headers['cache-control']).toContain('private');
  });
});
