import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { ShareLink, ShareLinkCreate, ShareLinkUpdate, TimeRange } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { forbidden, notFound, unprocessable } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';

/**
 * The `shareLinks` collection: an address somebody can hand out, and the window
 * it may be read through.
 *
 * Making a link, changing one and ending one are all `own` on what the link
 * points at, because a link is a key to somebody's diary and handing keys out is
 * not something a co-manager does on their behalf. The link's own token, who
 * made it and how often it has been opened are the server's; a client names the
 * subject and the window and nothing else.
 *
 * Resolving a link is the other half and lives in `SharedController`: what is
 * read *through* a link never carries the link.
 */

/**
 * 24 random bytes as base64url, so a token is 32 characters somebody can paste
 * into a chat and nothing anybody can arrive at by trying. It is separate from
 * the link's `id` precisely so that listing, patching and revoking need no
 * secret.
 */
const TOKEN_BYTES = 24;

/**
 * How often opening a link is allowed to write.
 *
 * Every anonymous read of a shared diary used to be a database write, which is
 * the one thing an unauthenticated route should not be - a link pasted into a
 * busy channel is a write per reader, and a loop is a write per request. The
 * counters exist so that a grower can see their link is being read, and for
 * that a minute's resolution is as good as an exact tally: what is lost is the
 * difference between "read a lot" and "read a lot", and what is gained is that
 * the write rate of the route is bounded by the number of links rather than by
 * the number of requests.
 */
const COUNT_AT_MOST_EVERY_MS = 60_000;

@Injectable()
export class ShareLinksService {
  /** When each token was last counted, so that a burst on one link is one write. In memory, like the rate limiter and for the same reason. */
  private readonly counted = new Map<string, number>();

  constructor(
    @InjectModel(MODEL_V1.shareLink) private readonly shareLinks: Model<ShareLinkDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    private readonly access: AccessService,
  ) {}

  /** Newest first: a list of links is what somebody made last, and the sharing sheet opens on it. */
  public async list(ctx: AccessContext, query: PageQuery): Promise<CursorPage<ShareLink>> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged into one object: the visibility below is an
    // `$or` and so is the cursor, and one spread beside the other would replace
    // it - which would hand out every link in the database from the second page
    // on, while the first page looked right.
    const conditions: FilterQuery<ShareLinkDocument>[] = [await this.visibleTo(ctx), afterCursor('createdAt', query.cursor)];

    const rows = await this.shareLinks.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<ShareLinkDocument[]>();

    const page = pageOf(rows, limit, link => ({ at: link.createdAt, id: link.id }));
    return { items: page.items.map(serialise), nextCursor: page.nextCursor };
  }

  /**
   * The links a caller may see at all, as one filter rather than a decision per
   * row: the ones they made, and the ones onto something they own - because a
   * link somebody else made onto your tent is yours to find and revoke, and
   * because a link outlives whoever created it.
   *
   * An administrator is answered as the person here, not as the office. This
   * list is what "Me - Share links" draws, and a serialised link carries the
   * token itself, so widening it would put a working anonymous key to every
   * customer's tent on the operator's own settings page. The office reaches one
   * named link through `access()`, which is a deliberate act on a row somebody
   * has reported; a listing is not.
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<ShareLinkDocument>> {
    const userId = this.accountOf(ctx);
    const [grows, spaces] = await Promise.all([
      this.grows.find({ ownerId: userId }, { id: 1 }).lean<Pick<GrowDocument, 'id'>[]>(),
      this.spaces.find({ ownerId: userId }, { id: 1 }).lean<Pick<SpaceDocument, 'id'>[]>(),
    ]);

    return {
      $or: [
        { createdBy: userId },
        { 'subject.type': 'grow', 'subject.id': { $in: grows.map(grow => grow.id) } },
        { 'subject.type': 'space', 'subject.id': { $in: spaces.map(space => space.id) } },
      ],
    };
  }

  public async create(ctx: AccessContext, body: ShareLinkCreate): Promise<ShareLink> {
    const createdBy = this.accountOf(ctx);
    await this.access.require(ctx, subjectRef(body.subject.type, body.subject.id), 'own');

    const range = rangeOf(body.range);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    refuseADeadWindow(range, expiresAt);
    if (body.kind === 'public_page') await this.refuseAPageThatIsNotThere(body.subject);

    const link: ShareLinkDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      token: randomBytes(TOKEN_BYTES).toString('base64url'),
      kind: body.kind,
      subject: { type: body.subject.type, id: body.subject.id },
      range,
      // A link carries no pictures unless it was made to: the quiet direction is
      // the one a link that says nothing takes.
      includeCameras: body.includeCameras ?? false,
      createdBy,
      expiresAt,
      revokedAt: null,
      state: { openCount: 0, lastOpenedAt: null },
    };

    await this.shareLinks.create(link);
    return serialise(link);
  }

  /**
   * Narrowing a link that is already out of the house: the window, the pictures
   * and when it stops working. Not what it points at - the address is in
   * somebody else's hands, and repointing it would show them something they were
   * never sent - which is what `ShareLinkUpdate` leaves out.
   */
  public async update(ctx: AccessContext, id: string, body: ShareLinkUpdate): Promise<ShareLink> {
    const link = await this.require(ctx, id);

    const changes = {
      ...(body.range === undefined ? {} : { range: rangeOf(body.range) }),
      ...(body.includeCameras === undefined ? {} : { includeCameras: body.includeCameras }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }),
    };

    // Against the window the link would then have, not against what the request
    // carries: narrowing one end alone is how a window ends up behind itself.
    // An expiry that is already past is only looked at where the request names
    // one, so a link that ran out long ago can still have its range taken in.
    refuseADeadWindow(changes.range ?? link.range, body.expiresAt === undefined ? null : (changes.expiresAt ?? null));

    const changed = await this.shareLinks.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<ShareLinkDocument>();
    if (!changed) throw notFound('share_link_not_found', 'There is no share link with that id.');

    return serialise(changed);
  }

  /**
   * Revoking is not deleting: the link stays listed, with the instant it stopped
   * working on it, so that somebody who sent one out can see that they did and
   * that it is over. Revoking twice does not move that instant.
   */
  public async revoke(ctx: AccessContext, id: string): Promise<ShareLink> {
    const link = await this.require(ctx, id);
    if (link.revokedAt !== null) return serialise(link);

    const changed = await this.shareLinks.findOneAndUpdate({ id }, { $set: { revokedAt: new Date() } }, { new: true }).lean<ShareLinkDocument>();
    if (!changed) throw notFound('share_link_not_found', 'There is no share link with that id.');

    return serialise(changed);
  }

  /** Deleting takes the row with it. A link that was sent out and is regretted is revoked instead. */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    await this.require(ctx, id);
    await this.shareLinks.deleteOne({ id });
  }

  /**
   * Opening a link, which is the one route that takes a token.
   *
   * A link that has been revoked, or whose day has passed, answers exactly what
   * a token nobody ever issued answers: nothing is there. A stranger with a dead
   * link learns neither that it once worked nor that it was taken back - which
   * is why this is a 404 and not a 403.
   *
   * The counters are moved on the way past, at most once a minute per token.
   * They are the owner's only sign that a link is being read at all, so a read
   * that does not move them is a read they never see - and a write per read is
   * how an unauthenticated route becomes a way to make this server work.
   */
  public async open(token: string, now: Date = new Date()): Promise<ShareLinkDocument> {
    const link = await this.shareLinks.findOne({ token }).lean<ShareLinkDocument>();
    if (!link || link.revokedAt !== null || (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime())) {
      throw notFound('share_link_not_found', 'That link leads nowhere.');
    }

    if (this.countable(token, now)) {
      await this.shareLinks.updateOne({ id: link.id }, { $inc: { 'state.openCount': 1 }, $set: { 'state.lastOpenedAt': now } });
    }

    return link;
  }

  /** Whether this opening is the one that counts for its minute, and remembering that it was. */
  private countable(token: string, now: Date): boolean {
    const at = now.getTime();
    const last = this.counted.get(token);
    if (last !== undefined && at - last < COUNT_AT_MOST_EVERY_MS) return false;

    // Swept as it is written rather than on a timer: what is left is the links
    // opened in the last minute, which is as large as the traffic and no larger.
    for (const [seen, when] of this.counted) {
      if (at - when >= COUNT_AT_MOST_EVERY_MS) this.counted.delete(seen);
    }

    this.counted.set(token, at);
    return true;
  }

  /**
   * One link, for somebody who may own what it points at. The decision is asked
   * of the subject rather than of the link, because owning the tent is what
   * makes the keys to it yours.
   */
  private async require(ctx: AccessContext, id: string): Promise<ShareLinkDocument> {
    const link = await this.shareLinks.findOne({ id }).lean<ShareLinkDocument>();
    if (!link) throw notFound('share_link_not_found', 'There is no share link with that id.');

    await this.access.require(ctx, subjectRef(link.subject.type, link.subject.id), 'own');
    return link;
  }

  /**
   * A public-page link is the public address of a grow in a form that can be
   * sent, and opens only while the grow is public. A space never is, and a grow
   * that is private has no page to send - either link would 404 on its first
   * opening, so it is refused to the maker instead of the reader.
   */
  private async refuseAPageThatIsNotThere(subject: ShareLinkCreate['subject']): Promise<void> {
    if (subject.type !== 'grow') {
      throw unprocessable('no_public_page', 'Only a grow has a public page. Share a space with a read-only view link instead.');
    }

    const grow = await this.grows.findOne({ id: subject.id }, { visibility: 1 }).lean<Pick<GrowDocument, 'visibility'>>();
    if (grow?.visibility !== 'public') {
      throw unprocessable(
        'no_public_page',
        'This grow is private, so it has no public page to link to. Make it public first, or share it with a read-only view link.',
      );
    }
  }

  /** A link belongs to somebody, and a demo session is nobody. */
  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'This route is about an account, and a demo session is not one.');

    return ctx.userId;
  }
}

/**
 * A window a link could never show anything through, refused while it is still
 * the maker's to correct.
 *
 * Both shapes are visible the moment they arrive and neither can be anything
 * but a mistake. A range whose end falls before its start is the narrowest
 * window there is: the link resolves, draws the diary's name and a Copy button,
 * and holds no week, no line and no photograph, for ever. An expiry that has
 * already passed is a link that is dead when it is handed back - the token 404s
 * on its first opening, in the same words a token nobody issued gets, so
 * neither the grower nor the person they sent it to can tell what went wrong.
 * Ending a link that is out of the house is `PUT /share-links/{id}/revocation`,
 * which keeps it listed and says when it stopped.
 *
 * Refused rather than corrected, and refused with a sentence, because the same
 * route already refuses a subject it cannot make sense of and the camera beside
 * it refuses a film that ends before it starts.
 */
const refuseADeadWindow = (range: ShareLinkDocument['range'], expiresAt: Date | null, now: Date = new Date()): void => {
  if (range.startsAt !== null && range.endsAt !== null && range.endsAt < range.startsAt) {
    throw unprocessable(
      'span_backwards',
      'A link ends after it begins. Those two dates are the wrong way round, so this link could never show anything.',
    );
  }

  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    throw unprocessable(
      'expiry_already_past',
      'A link that has already run out leads nowhere the moment it is made. Leave the expiry out for one that does not run out, and revoke a link that is already in somebody else´s hands.',
    );
  }
};

/** An open end is a link that keeps up with a diary as it goes on, which is what sharing a running grow means. */
const rangeOf = (range: TimeRange | undefined): ShareLinkDocument['range'] => ({
  startsAt: range?.startsAt ? new Date(range.startsAt) : null,
  endsAt: range?.endsAt ? new Date(range.endsAt) : null,
});

/** Field by field, because `_id` rides on a stored document and never leaves the server. */
const serialise = (link: ShareLinkDocument): ShareLink => ({
  id: link.id,
  createdAt: link.createdAt.toISOString(),
  token: link.token,
  kind: link.kind,
  subject: { type: link.subject.type, id: link.subject.id },
  range: { startsAt: link.range.startsAt?.toISOString() ?? null, endsAt: link.range.endsAt?.toISOString() ?? null },
  includeCameras: link.includeCameras,
  createdBy: link.createdBy,
  expiresAt: link.expiresAt?.toISOString() ?? null,
  revokedAt: link.revokedAt?.toISOString() ?? null,
  state: { openCount: link.state.openCount, lastOpenedAt: link.state.lastOpenedAt?.toISOString() ?? null },
});
