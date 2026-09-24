import { anonymous, context, createAccount, demoSession, login, loginAsAdmin, Session, unique } from '../support/api';

/**
 * What a token is still good for.
 *
 * The tokens are signed rather than looked up, so each of them states what was
 * true when it was handed out and goes on stating it: a user token for five
 * minutes, the one in a picture's URL for thirty days. Every route behind the
 * guards therefore resolves its caller against the rows - the session, which
 * revoking deletes, and the account, which says whether it is still active and
 * still privileged - so that ending a session, deactivating an account and
 * taking somebody's administrator flag away are all immediate rather than
 * eventual.
 *
 * The other half of this spec is what must not be caught by that: the token a
 * picture's URL carries, the demo that has a session and no account, the
 * install's own token that has neither, and a share link, which is not a
 * session at all.
 */

const PASSWORD = 'Passw0rd!test';

/** A 2x2 PNG, which is all any of these need to have a picture at all. */
const A_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AzbAxIAdjEoRlgIAaFcDAx2LUNMAAAAASUVORK5CYII=',
  'base64',
);

let admin: Session;

const anAdminAccount = async (prefix: string): Promise<{ id: string; session: Session }> => {
  const username = `${unique(prefix)}@test.invalid`;
  const created = (
    await admin.client
      .post('/v1/admin/users')
      .send({ email: username, handle: unique(prefix), password: PASSWORD, isAdmin: true })
      .expect(201)
  ).body;

  return { id: created.id, session: await login(username, PASSWORD) };
};

beforeAll(async () => {
  admin = await loginAsAdmin();
});

/**
 * The one list in the API whose rows move while it is being read: every
 * signed-in client renews about every five minutes, and a renewal rewrote the
 * very field the walk was keyed on. A row that had not been handed out yet then
 * jumped above the cursor and was gone from that walk - on the screen somebody
 * opens after a laptop has gone missing, and the row lost was by definition the
 * one most recently used.
 */
describe('walking the list of sessions', () => {
  it('hands out every session, even one that is renewed before the walk reaches it', async () => {
    const user = await createAccount('paged-sessions');
    await login(user.username, user.password);
    await login(user.username, user.password);

    const whole = (await user.client.get('/v1/sessions?limit=200').expect(200)).body;
    expect(whole.items).toHaveLength(3);
    expect(whole.nextCursor).toBe(null);

    // A page at a time, and the account's own first session - the last one the
    // walk will reach - is used again after the first page has come back.
    const walked: string[] = [];
    let cursor: string | null = null;

    do {
      const query: string = cursor === null ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const answered = (await user.client.get(`/v1/sessions${query}`).expect(200)).body;

      walked.push(...answered.items.map((row: { id: string }) => row.id));
      cursor = answered.nextCursor as string | null;

      if (walked.length === 1) {
        await anonymous().post('/v1/sessions/refresh').send({ refreshToken: user.refreshToken }).expect(200);
        expect(walked).not.toContain(user.sessionId);
      }
    } while (cursor !== null);

    expect(new Set(walked).size).toBe(walked.length);
    expect([...walked].sort()).toEqual(whole.items.map((row: { id: string }) => row.id).sort());
    expect(walked).toContain(user.sessionId);
  });
});

describe('a session that has been ended', () => {
  it('stops answering the moment it is revoked, rather than when its token runs out', async () => {
    const user = await createAccount('revoked');
    await user.client.get('/v1/me').expect(200);

    await user.client.delete(`/v1/sessions/${user.sessionId}`).expect(204);

    await user.client.get('/v1/me').expect(401);
    await anonymous().post('/v1/sessions/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });

  it('takes that one session and none of the account´s others', async () => {
    const user = await createAccount('one-of-two');
    const elsewhere = await login(user.username, user.password);

    await user.client.delete(`/v1/sessions/${user.sessionId}`).expect(204);

    await user.client.get('/v1/me').expect(401);
    await elsewhere.client.get('/v1/me').expect(200);
  });
});

describe('signing every other browser out', () => {
  it('ends the others and keeps the one asking', async () => {
    const user = await createAccount('sweep');
    const laptop = await login(user.username, user.password);
    const phone = await login(user.username, user.password);

    await user.client.delete('/v1/sessions').expect(204);

    await user.client.get('/v1/me').expect(200);
    await laptop.client.get('/v1/me').expect(401);
    await phone.client.get('/v1/me').expect(401);
    // Not merely refused: the rows are gone, so a renewal finds nothing either.
    await anonymous().post('/v1/sessions/refresh').send({ refreshToken: laptop.refreshToken }).expect(401);
  });

  it('is nobody else´s doing, and reaches no other account', async () => {
    const mine = await createAccount('sweep-mine');
    const theirs = await createAccount('sweep-theirs');
    const alsoTheirs = await login(theirs.username, theirs.password);

    await mine.client.delete('/v1/sessions').expect(204);

    await theirs.client.get('/v1/me').expect(200);
    await alsoTheirs.client.get('/v1/me').expect(200);
  });

  /**
   * Changing a password is what somebody does when they think it has been seen,
   * so the browsers it was seen in have to stop. The one doing the changing
   * keeps its session: being signed out by the act of securing the account is
   * how people learn not to bother.
   */
  it('happens on its own when the password is changed', async () => {
    const user = await createAccount('password-sweep');
    const elsewhere = await login(user.username, user.password);

    await user.client.put('/v1/me/password').send({ currentPassword: user.password, newPassword: 'Passw0rd!after' }).expect(204);

    await user.client.get('/v1/me').expect(200);
    await elsewhere.client.get('/v1/me').expect(401);
  });
});

describe('an account an administrator changes underneath it', () => {
  it('is signed in for exactly as long as it is active', async () => {
    const user = await createAccount('deactivated');
    await user.client.get('/v1/me').expect(200);

    await admin.client.patch(`/v1/admin/users/${user.userId}`).send({ isActive: false }).expect(200);
    await user.client.get('/v1/me').expect(401);

    await admin.client.patch(`/v1/admin/users/${user.userId}`).send({ isActive: true }).expect(200);
    await user.client.get('/v1/me').expect(200);
  });

  it('is an administrator for exactly as long as the row says so', async () => {
    const made = await anAdminAccount('demoted');
    await made.session.client.get('/v1/admin/users').expect(200);

    await admin.client.patch(`/v1/admin/users/${made.id}`).send({ isAdmin: false }).expect(200);

    // Told no rather than signed out: a 401 here reads as a dead token to a
    // client that refreshes on one.
    await made.session.client.get('/v1/admin/users').expect(403);
    // Still an account and still signed in; only no longer privileged.
    await made.session.client.get('/v1/me').expect(200);
  });
});

describe('the callers that are not a user session', () => {
  it('serves a picture to the token its URL carries', async () => {
    const user = await createAccount('media-token');
    const grow = (await user.client.post('/v1/grows').send({ name: 'Photographed', type: 'photoperiod', plants: [] }).expect(201)).body;
    const picture = (
      await user.client.post('/v1/media').field('kind', 'photo').field('growId', grow.id).attach('file', A_PICTURE, 'a.png').expect(201)
    ).body;

    // No session on the request at all, which is what an <img> element sends.
    await anonymous().get(`/v1/media/${picture.id}/content?token=${user.imageToken}`).expect(200);
    await anonymous().get(`/v1/media/${picture.id}?token=${user.imageToken}`).expect(200);

    // And it is the session's, not a thirty-day key of its own: ending the
    // session ends what the URL can ask for too.
    await user.client.delete(`/v1/sessions/${user.sessionId}`).expect(204);
    await anonymous().get(`/v1/media/${picture.id}/content?token=${user.imageToken}`).expect(404);
  });

  it('lets the demo read, though it is an account nowhere', async () => {
    const demo = await demoSession();

    await demo.client.get('/v1/devices').expect(200);
    await demo.client.get('/v1/home').expect(200);
  });

  it('lets the install´s own token administer, though it names no session', async () => {
    const bought = (await anonymous().post('/v1/sessions/automation').send({ token: context.automationToken }).expect(200)).body;

    await anonymous().get('/v1/admin/users').set('Authorization', `Bearer ${bought.userToken.token}`).expect(200);
  });

  it('resolves a share link for somebody with no session at all', async () => {
    const user = await createAccount('sharer');
    const grow = (await user.client.post('/v1/grows').send({ name: 'Shared', type: 'photoperiod', plants: [] }).expect(201)).body;
    const picture = (
      await user.client.post('/v1/media').field('kind', 'photo').field('growId', grow.id).attach('file', A_PICTURE, 'a.png').expect(201)
    ).body;
    const link = (
      await user.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'grow', id: grow.id } })
        .expect(201)
    ).body;

    await anonymous().get(`/v1/shared/${link.token}`).expect(200);
    // The picture route takes a session where there is one and a share link
    // where there is not, so it is what says the second still works.
    await anonymous().get(`/v1/media/${picture.id}?share=${link.token}`).expect(200);
  });
});
