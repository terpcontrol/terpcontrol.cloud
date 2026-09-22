import { anonymous, createAccount, demoSession, Session } from '../support/api';
import { setRow } from '../support/fixtures';
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

/**
 * The other half of sharing: not a window onto a diary but a place in a tent.
 *
 * What is asserted most here is what must not be there. A member is the one
 * thing in the model that widens what a second account may do, and an invite is
 * a code anybody at all may guess at, so each of the routes below is checked
 * from the outside as well as from the inside: what a stranger sees, what a
 * share link does not become, what a dead code answers, and what somebody who
 * was let in still cannot do.
 */
describe('the people in a space', () => {
  let host: Session;
  let guest: Session;
  let room: string;
  let inTheRoom: string;

  const invite = async (session: Session, spaceId: string, body: Record<string, unknown> = { role: 'can_log' }) =>
    (await session.client.post(`/v1/spaces/${spaceId}/invites`).send(body).expect(201)).body;

  const accept = (session: Session, code: string, status = 201) => session.client.post(`/v1/invites/${code}/acceptances`).expect(status);

  beforeAll(async () => {
    host = await createAccount('members-host');
    guest = await createAccount('members-guest');

    room = (await host.client.post('/v1/spaces').send({ kind: 'room', name: 'Grow room' }).expect(201)).body.id;
    inTheRoom = (await host.client.post('/v1/spaces').send({ kind: 'tent', name: 'Tent 1', roomId: room }).expect(201)).body.id;
  });

  describe('an invite', () => {
    it('invents the code, the author and the counters, whatever the body says', async () => {
      const made = await invite(host, inTheRoom, { role: 'can_manage', code: 'CHOSEN12', createdBy: guest.userId, state: { useCount: 99 } });

      expect(made.code).toMatch(/^[ABCDEFGHKMNPRSTUVWXYZ23456789]{8}$/);
      expect(made.code).not.toBe('CHOSEN12');
      expect(made.createdBy).toBe(host.userId);
      expect(made.role).toBe('can_manage');
      expect(made.state).toEqual({ useCount: 0, lastUsedAt: null });
      expect(made.revokedAt).toBeNull();

      // The sheet says a week, and a link pasted into a chat group outlives the
      // conversation if nothing says otherwise.
      const days = (new Date(made.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });

    it('is the owner´s to cut and to list, and nobody else´s', async () => {
      await guest.client.post(`/v1/spaces/${inTheRoom}/invites`).send({ role: 'can_log' }).expect(404);
      await guest.client.get(`/v1/spaces/${inTheRoom}/invites`).expect(404);
    });

    it('shows a stranger where they are being asked and who by, and no id of anything', async () => {
      const made = await invite(host, inTheRoom);
      const preview = await anonymous().get(`/v1/invites/${made.code}`).expect(200);

      expect(preview.body).toEqual({
        isValid: true,
        spaceName: 'Tent 1',
        spaceKind: 'tent',
        role: 'can_log',
        invitedByHandle: expect.any(String),
        expiresAt: made.expiresAt,
      });

      // A link lives in a chat group, so whatever this answers everybody there
      // can read: not the space, not the inviter, not the invite itself.
      const said = JSON.stringify(preview.body);
      expect(said).not.toContain(inTheRoom);
      expect(said).not.toContain(room);
      expect(said).not.toContain(host.userId);
      expect(said).not.toContain(made.id);
    });

    it('answers a code that is revoked, expired or was never issued exactly the same nothing', async () => {
      const nothing = { isValid: false, spaceName: null, spaceKind: null, role: null, invitedByHandle: null, expiresAt: null };

      const revoked = await invite(host, inTheRoom);
      await host.client.put(`/v1/invites/${revoked.code}/revocation`).expect(200);

      const expired = await invite(host, inTheRoom);
      await setRow('invites', { code: expired.code }, { expiresAt: new Date(Date.now() - 1000) });

      expect((await anonymous().get(`/v1/invites/${revoked.code}`).expect(200)).body).toEqual(nothing);
      expect((await anonymous().get(`/v1/invites/${expired.code}`).expect(200)).body).toEqual(nothing);
      expect((await anonymous().get('/v1/invites/NEVERMDE').expect(200)).body).toEqual(nothing);
    });

    it('is revoked rather than deleted, and revoking twice keeps the instant', async () => {
      const made = await invite(host, inTheRoom);

      const revoked = await host.client.put(`/v1/invites/${made.code}/revocation`).expect(200);
      expect(revoked.body.revokedAt).toEqual(expect.any(String));

      const again = await host.client.put(`/v1/invites/${made.code}/revocation`).expect(200);
      expect(again.body.revokedAt).toBe(revoked.body.revokedAt);

      const listed = await host.client.get(`/v1/spaces/${inTheRoom}/invites?limit=200`).expect(200);
      expect(listed.body.items.map((one: { code: string }) => one.code)).toContain(made.code);
    });

    it('is deleted outright where somebody wants it forgotten', async () => {
      const made = await invite(host, inTheRoom);

      await host.client.delete(`/v1/invites/${made.code}`).expect(204);
      await host.client.delete(`/v1/invites/${made.code}`).expect(404);
      expect((await anonymous().get(`/v1/invites/${made.code}`).expect(200)).body.isValid).toBe(false);
    });

    it('is not there as far as anybody else is concerned', async () => {
      const made = await invite(host, inTheRoom);

      await guest.client.put(`/v1/invites/${made.code}/revocation`).expect(404);
      await guest.client.delete(`/v1/invites/${made.code}`).expect(404);
      await anonymous().put(`/v1/invites/${made.code}/revocation`).expect(401);
    });
  });

  describe('taking one up', () => {
    it('lets somebody in with the role the code carries, and names the place they arrived at', async () => {
      const arriving = await createAccount('members-arriving');
      const made = await invite(host, inTheRoom, { role: 'can_manage' });

      const joined = (await accept(arriving, made.code)).body;

      expect(joined.membership).toMatchObject({ spaceId: inTheRoom, userId: arriving.userId, role: 'can_manage', inviteId: made.id });
      expect(joined.membership.invitedBy).toBe(host.userId);
      expect(joined.space).toMatchObject({ id: inTheRoom, name: 'Tent 1' });

      const counted = await host.client.get(`/v1/spaces/${inTheRoom}/invites?limit=200`).expect(200);
      expect(counted.body.items.find((one: { id: string }) => one.id === made.id).state.useCount).toBe(1);
    });

    it('refuses the same person a second time, rather than quietly saying yes again', async () => {
      const twice = await createAccount('members-twice');
      const made = await invite(host, inTheRoom);

      await accept(twice, made.code);
      const refused = await accept(twice, made.code, 409);
      expect(refused.body.code).toBe('already_a_member');

      // And a second code into the same space is no way round it.
      const another = await invite(host, inTheRoom, { role: 'can_manage' });
      await accept(twice, another.code, 409);
    });

    it('refuses a code that is revoked, expired or was never issued, and says no more than that', async () => {
      const late = await createAccount('members-late');

      const revoked = await invite(host, inTheRoom);
      await host.client.put(`/v1/invites/${revoked.code}/revocation`).expect(200);
      const expired = await invite(host, inTheRoom);
      await setRow('invites', { code: expired.code }, { expiresAt: new Date(Date.now() - 1000) });

      for (const code of [revoked.code, expired.code, 'NEVERMDE']) {
        const refused = await accept(late, code, 404);
        expect(refused.body.code).toBe('invite_not_found');
      }

      const seen = await late.client.get('/v1/spaces?limit=200').expect(200);
      expect(seen.body.items.map((one: { id: string }) => one.id)).not.toContain(inTheRoom);
    });

    it('takes an account; a tour of the demo joins nothing', async () => {
      const made = await invite(host, inTheRoom);
      const demo = await demoSession();

      await demo.client.post(`/v1/invites/${made.code}/acceptances`).expect(403);
      await anonymous().post(`/v1/invites/${made.code}/acceptances`).expect(401);

      const still = await host.client.get(`/v1/spaces/${inTheRoom}/invites?limit=200`).expect(200);
      expect(still.body.items.find((one: { id: string }) => one.id === made.id).state.useCount).toBe(0);
    });
  });

  describe('the list of who is here', () => {
    it('draws the room´s people beside the tent´s own, and names the room they come through', async () => {
      const ofTheRoom = await createAccount('members-room');
      const ofTheTent = await createAccount('members-tent');

      await accept(ofTheRoom, (await invite(host, room)).code);
      await accept(ofTheTent, (await invite(host, inTheRoom)).code);

      const listed = await host.client.get(`/v1/spaces/${inTheRoom}/members?limit=200`).expect(200);
      const rows: { userId: string; spaceId: string }[] = listed.body.items;

      expect(rows.find(row => row.userId === ofTheRoom.userId)?.spaceId).toBe(room);
      expect(rows.find(row => row.userId === ofTheTent.userId)?.spaceId).toBe(inTheRoom);
      expect(listed.body.room).toEqual({ id: room, name: 'Grow room' });
      expect(listed.body.people.map((one: { id: string }) => one.id)).toEqual(expect.arrayContaining([ofTheRoom.userId, ofTheTent.userId]));
    });

    it('is read by everybody who is in the tent and by nobody who merely holds a key to it', async () => {
      const inside = await createAccount('members-inside');
      await accept(inside, (await invite(host, inTheRoom)).code);

      await inside.client.get(`/v1/spaces/${inTheRoom}/members`).expect(200);
      await stranger.client.get(`/v1/spaces/${inTheRoom}/members`).expect(404);
      await (await demoSession()).client.get(`/v1/spaces/${inTheRoom}/members`).expect(404);

      // A share link onto the space is `view` on the space, and the guest list
      // is not part of what a link was handed out to show.
      const link = (
        await host.client
          .post('/v1/share-links')
          .send({ kind: 'view', subject: { type: 'space', id: inTheRoom } })
          .expect(201)
      ).body;
      const holder = await createAccount('members-linkholder');

      await holder.client.get(`/v1/spaces/${inTheRoom}/members`).expect(404);
      await holder.client.get(`/v1/spaces/${inTheRoom}/members?share=${link.token}`).expect(404);
    });

    it('is continued page by page without widening past this tent and its room', async () => {
      const elsewhere = (await host.client.post('/v1/spaces').send({ kind: 'tent', name: 'Another tent' }).expect(201)).body.id;
      const other = await createAccount('members-elsewhere');
      await accept(other, (await invite(host, elsewhere)).code);

      const seen: { spaceId: string }[] = [];
      let cursor: string | null = null;
      do {
        const where: string = `/v1/spaces/${inTheRoom}/members?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await host.client.get(where).expect(200);
        seen.push(...page.body.items);
        cursor = page.body.nextCursor as string | null;
      } while (cursor && seen.length < 30);

      expect(seen.length).toBeGreaterThan(1);
      expect(seen.every(row => row.spaceId === inTheRoom || row.spaceId === room)).toBe(true);
    });
  });

  describe('what being let in is not', () => {
    let logger: Session;
    let manager: Session;
    let theirTent: string;

    beforeAll(async () => {
      logger = await createAccount('members-logger');
      manager = await createAccount('members-manager');
      theirTent = (await host.client.post('/v1/spaces').send({ kind: 'tent', name: 'The shared tent' }).expect(201)).body.id;

      await accept(logger, (await invite(host, theirTent)).code);
      await accept(manager, (await invite(host, theirTent, { role: 'can_manage' })).code);
    });

    it('does not make anybody the host: neither role hands out the way in', async () => {
      for (const session of [logger, manager]) {
        await session.client.post(`/v1/spaces/${theirTent}/invites`).send({ role: 'can_log' }).expect(403);
        await session.client.get(`/v1/spaces/${theirTent}/invites`).expect(403);
        await session.client.post(`/v1/spaces/${theirTent}/members`).send({ handle: 'whoever', role: 'can_log' }).expect(403);
        await session.client.patch(`/v1/spaces/${theirTent}/members/${logger.userId}`).send({ role: 'can_manage' }).expect(403);
        await session.client.delete(`/v1/spaces/${theirTent}`).expect(403);
      }

      // Nor does a manager show a co-guest the door.
      await manager.client.delete(`/v1/spaces/${theirTent}/members/${logger.userId}`).expect(403);
      await logger.client.get(`/v1/spaces/${theirTent}`).expect(200);
    });

    it('lets somebody walk back out without asking the person who let them in', async () => {
      const leaving = await createAccount('members-leaving');
      await accept(leaving, (await invite(host, theirTent)).code);

      await leaving.client.delete(`/v1/spaces/${theirTent}/members/${leaving.userId}`).expect(204);
      await leaving.client.get(`/v1/spaces/${theirTent}`).expect(404);

      const listed = await host.client.get(`/v1/spaces/${theirTent}/members?limit=200`).expect(200);
      expect(listed.body.items.map((row: { userId: string }) => row.userId)).not.toContain(leaving.userId);
    });

    it('is ended by the host, and the space cannot be ended while it stands', async () => {
      const refused = await host.client.delete(`/v1/spaces/${theirTent}`).expect(409);
      expect(refused.body.code).toBe('space_in_use');
      expect(refused.body.errors.map((one: { code: string }) => one.code)).toContain('member_here');

      await host.client.delete(`/v1/spaces/${theirTent}/members/${logger.userId}`).expect(204);
      await host.client.delete(`/v1/spaces/${theirTent}/members/${manager.userId}`).expect(204);
      await host.client.delete(`/v1/spaces/${theirTent}`).expect(204);
    });
  });

  describe('adding somebody by the name you know them under', () => {
    it('takes a handle you already grow with, and refuses every other one the same way', async () => {
      const known = await createAccount('members-known');
      const unknown = await createAccount('members-unknown');
      await accept(known, (await invite(host, inTheRoom)).code);

      const second = (await host.client.post('/v1/spaces').send({ kind: 'tent', name: 'Second tent' }).expect(201)).body.id;
      const added = await host.client.post(`/v1/spaces/${second}/members`).send({ handle: known.handle, role: 'can_manage' }).expect(201);

      expect(added.body).toMatchObject({ spaceId: second, userId: known.userId, role: 'can_manage', inviteId: null });
      expect(added.body.invitedBy).toBe(host.userId);

      // Somebody this account has never grown with, and a name nobody holds,
      // are the same answer: the field is not a way of asking who is here.
      const stranger404 = await host.client.post(`/v1/spaces/${second}/members`).send({ handle: unknown.handle, role: 'can_log' }).expect(404);
      const nobody404 = await host.client.post(`/v1/spaces/${second}/members`).send({ handle: 'nobody-at-all', role: 'can_log' }).expect(404);

      expect(stranger404.body.code).toBe('handle_not_found');
      expect(nobody404.body).toEqual(stranger404.body);
    });

    it('will not make the owner a member of their own space, nor anybody a member twice', async () => {
      const both = await createAccount('members-both');
      await accept(both, (await invite(host, inTheRoom)).code);

      const third = (await host.client.post('/v1/spaces').send({ kind: 'tent', name: 'Third tent' }).expect(201)).body.id;
      await host.client.post(`/v1/spaces/${third}/members`).send({ handle: host.handle, role: 'can_log' }).expect(404);
      await host.client.post(`/v1/spaces/${third}/members`).send({ handle: both.handle, role: 'can_log' }).expect(201);

      const again = await host.client.post(`/v1/spaces/${third}/members`).send({ handle: both.handle, role: 'can_manage' }).expect(409);
      expect(again.body.code).toBe('already_a_member');
    });

    it('leaves a row that belongs to the room to the room', async () => {
      const ofTheRoom = await createAccount('members-roomrow');
      await accept(ofTheRoom, (await invite(host, room)).code);

      const refused = await host.client.patch(`/v1/spaces/${inTheRoom}/members/${ofTheRoom.userId}`).send({ role: 'can_log' }).expect(409);
      expect(refused.body.code).toBe('member_of_the_room');
      await host.client.delete(`/v1/spaces/${inTheRoom}/members/${ofTheRoom.userId}`).expect(409);

      // The room itself still answers for its own people.
      await host.client.patch(`/v1/spaces/${room}/members/${ofTheRoom.userId}`).send({ role: 'can_manage' }).expect(200);
    });

    it('says nobody is there rather than who, for a member id this space has never had', async () => {
      const refused = await host.client.patch(`/v1/spaces/${inTheRoom}/members/${stranger.userId}`).send({ role: 'can_log' }).expect(404);
      expect(refused.body.code).toBe('membership_not_found');
    });
  });
});
