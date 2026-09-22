import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { ShareLinksService } from '@modules/v1/sharing/share-links.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Share links, against a real database, because what is wrong about a list of
 * them is wrong in its query.
 *
 * The visibility filter here is an `$or` - a link is the caller's if they made
 * it or if they own what it points at - and so is the cursor that continues the
 * list. Merged into one object rather than combined with `$and`, the second one
 * silently replaces the first: the first page still looks right, and every page
 * after it answers every link in the database. That is the case these specs
 * exist for, so they walk the pages rather than reading the first one.
 */

const OWNER = 'user-owner';
const OTHER = 'user-other';

const TENT = 'space-tent';
const GROW = 'grow-1';

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const asAdmin = (userId: string): AccessContext => ({ userId, isAdmin: true, isDemo: false, shareToken: null });
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };

let db: V1TestDatabase;
let links: ShareLinksService;

const build = (): ShareLinksService => {
  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);

  return new ShareLinksService(db.shareLinks, db.grows, db.spaces, access);
};

/** One tent and one grow each for two accounts, so the wrong rows exist to be answered. */
const world = async (): Promise<void> => {
  await db.spaces.create([
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null },
    { id: 'space-theirs', ownerId: OTHER, kind: 'tent', name: 'Their tent', roomId: null },
  ]);

  await db.grows.create([
    { id: GROW, ownerId: OWNER, name: 'Mine', type: 'photoperiod', slug: 'mine', startedAt: new Date(), updatedAt: new Date() },
    { id: 'grow-theirs', ownerId: OTHER, name: 'Theirs', type: 'photoperiod', slug: 'theirs', startedAt: new Date(), updatedAt: new Date() },
  ]);
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  links = build();
  await world();
});

/** Every page of a list, followed by the cursor it hands out. */
const everyPage = async (ctx: AccessContext): Promise<ShareLinkDocument['id'][]> => {
  const seen: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const answered = await links.list(ctx, { limit: 1, cursor });
    seen.push(...answered.items.map(link => link.id));
    if (!answered.nextCursor) break;
    cursor = answered.nextCursor;
  }

  return seen;
};

describe('the list of links', () => {
  /**
   * Five links, and the two accounts' alternate in time. Interleaved on
   * purpose: a list whose visibility filter the cursor has replaced still
   * answers the right first page, and only shows what it is doing where
   * somebody else's row sorts between two of yours.
   */
  beforeEach(async () => {
    const made = [
      await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } }),
      await links.create(session(OTHER), { kind: 'view', subject: { type: 'grow', id: 'grow-theirs' } }),
      await links.create(session(OWNER), { kind: 'view', subject: { type: 'space', id: TENT } }),
      await links.create(session(OTHER), { kind: 'view', subject: { type: 'space', id: 'space-theirs' } }),
      await links.create(session(OWNER), { kind: 'public_page', subject: { type: 'grow', id: GROW } }),
    ];

    await Promise.all(
      made.map((link, minute) => db.shareLinks.updateOne({ id: link.id }, { $set: { createdAt: new Date(Date.UTC(2026, 5, 1, 10, minute)) } })),
    );
  });

  it('answers this account´s links on the first page and on every page after it', async () => {
    const seen = await everyPage(session(OWNER));

    expect(seen).toHaveLength(3);

    const rows = await db.shareLinks.find({ id: { $in: seen } }).lean<ShareLinkDocument[]>();
    expect(rows.every(row => row.createdBy === OWNER)).toBe(true);
  });

  it('answers the same for the other account, which is how the filter is shown to be doing anything', async () => {
    expect(await everyPage(session(OTHER))).toHaveLength(2);
  });

  it('holds a link somebody else made onto something this account owns', async () => {
    // A link is a key to the tent, and the tent is the owner's however the key
    // came to be cut - an administrator's seeding, an account that was handed on.
    await db.shareLinks.create({
      id: 'link-by-an-admin',
      token: 'token-by-an-admin',
      kind: 'view',
      subject: { type: 'space', id: TENT },
      createdBy: 'somebody-else',
    });

    expect(await everyPage(session(OWNER))).toContain('link-by-an-admin');
  });

  /**
   * The page this list draws is "Me - Share links", which is the person and not
   * the office. A serialised link carries the token, so an install-wide answer
   * would put a working key to every customer's tent under the operator's own
   * settings, with the same Copy button beside it.
   */
  it('holds none of a stranger´s links for an administrator, whose own page this is', async () => {
    const seen = await everyPage(asAdmin(OWNER));

    const rows = await db.shareLinks.find({ id: { $in: seen } }).lean<ShareLinkDocument[]>();
    expect(rows.some(row => row.createdBy === OTHER)).toBe(false);
    expect(seen).toHaveLength(3);

    const theirs = await db.shareLinks.find({ createdBy: OTHER }).lean<ShareLinkDocument[]>();
    for (const link of theirs) expect(seen).not.toContain(link.id);
  });

  it('is nobody´s for a session that is not an account', async () => {
    await expect(links.list(demo, {})).rejects.toThrow(ProblemException);
  });
});

describe('making one', () => {
  it('invents the token and the counters, and takes `own` on what it points at', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });

    expect(made.token).toEqual(expect.any(String));
    expect(made.token.length).toBeGreaterThan(20);
    expect(made.createdBy).toBe(OWNER);
    expect(made.state).toEqual({ openCount: 0, lastOpenedAt: null });

    await expect(links.create(session(OTHER), { kind: 'view', subject: { type: 'grow', id: GROW } })).rejects.toThrow(ProblemException);
  });

  it('gives two links two tokens, because a token is the whole of a reader´s proof', async () => {
    const one = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    const other = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });

    expect(one.token).not.toBe(other.token);
  });
});

describe('opening one', () => {
  it('moves the counters, which is the owner´s only sign that it is read', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    const at = new Date('2026-06-01T10:00:00.000Z');

    await links.open(made.token, at);

    const row = await db.shareLinks.findOne({ id: made.id }).lean<ShareLinkDocument>();
    expect(row?.state.openCount).toBe(1);
    expect(row?.state.lastOpenedAt?.toISOString()).toBe(at.toISOString());
  });

  /**
   * The route is anonymous and unauthenticated, so a write per read is a write
   * per request from anybody at all. A minute's resolution says the same thing
   * to the owner - their link is being read - and bounds the writes by the
   * number of links rather than by the number of requests.
   */
  it('counts a burst on one link once, and goes on counting the minute after', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    const at = new Date('2026-06-01T10:00:00.000Z');
    const seconds = (count: number): Date => new Date(at.getTime() + count * 1000);

    await links.open(made.token, at);
    await links.open(made.token, seconds(1));
    await links.open(made.token, seconds(59));

    const burst = await db.shareLinks.findOne({ id: made.id }).lean<ShareLinkDocument>();
    expect(burst?.state.openCount).toBe(1);
    expect(burst?.state.lastOpenedAt?.toISOString()).toBe(at.toISOString());

    await links.open(made.token, seconds(61));

    const later = await db.shareLinks.findOne({ id: made.id }).lean<ShareLinkDocument>();
    expect(later?.state.openCount).toBe(2);
    expect(later?.state.lastOpenedAt?.toISOString()).toBe(seconds(61).toISOString());
  });

  it('counts each link for itself, so one busy link does not hide another being opened', async () => {
    const one = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    const other = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    const at = new Date('2026-06-01T10:00:00.000Z');

    await links.open(one.token, at);
    await links.open(other.token, at);

    const rows = await db.shareLinks.find({ id: { $in: [one.id, other.id] } }).lean<ShareLinkDocument[]>();
    expect(rows.map(row => row.state.openCount)).toEqual([1, 1]);
  });

  it('leads nowhere once it is revoked or its day has passed, exactly as a token nobody issued does', async () => {
    const revoked = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });
    await links.revoke(session(OWNER), revoked.id);

    const expired = await links.create(session(OWNER), {
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      expiresAt: '2026-06-01T09:00:00.000Z',
    });

    const at = new Date('2026-06-01T10:00:00.000Z');
    await expect(links.open(revoked.token, at)).rejects.toThrow(ProblemException);
    await expect(links.open(expired.token, at)).rejects.toThrow(ProblemException);
    await expect(links.open('never-issued', at)).rejects.toThrow(ProblemException);

    // And a dead link is not counted as read: nothing was.
    const row = await db.shareLinks.findOne({ id: revoked.id }).lean<ShareLinkDocument>();
    expect(row?.state.openCount).toBe(0);
  });
});

describe('changing one', () => {
  it('narrows the window and the pictures, and never what the link points at', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW }, includeCameras: true });

    const changed = await links.update(session(OWNER), made.id, {
      includeCameras: false,
      range: { startsAt: '2026-05-01T00:00:00.000Z', endsAt: null },
    });

    expect(changed.includeCameras).toBe(false);
    expect(changed.range).toEqual({ startsAt: '2026-05-01T00:00:00.000Z', endsAt: null });
    expect(changed.subject).toEqual({ type: 'grow', id: GROW });
    expect(changed.kind).toBe('view');
  });

  it('is the owner´s to change, revoke and delete, and is not there for anybody else', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });

    await expect(links.update(session(OTHER), made.id, { includeCameras: true })).rejects.toThrow(ProblemException);
    await expect(links.revoke(session(OTHER), made.id)).rejects.toThrow(ProblemException);
    await expect(links.remove(session(OTHER), made.id)).rejects.toThrow(ProblemException);

    await links.remove(session(OWNER), made.id);
    expect(await db.shareLinks.findOne({ id: made.id }).lean()).toBeNull();
  });

  it('keeps the instant a link stopped working when it is revoked again', async () => {
    const made = await links.create(session(OWNER), { kind: 'view', subject: { type: 'grow', id: GROW } });

    const first = await links.revoke(session(OWNER), made.id);
    const again = await links.revoke(session(OWNER), made.id);

    expect(first.revokedAt).toEqual(expect.any(String));
    expect(again.revokedAt).toBe(first.revokedAt);
  });
});
