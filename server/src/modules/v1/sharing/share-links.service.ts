import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { ShareLink, ShareLinkCreate, ShareLinkUpdate, TimeRange } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { forbidden, notFound } from '@common/v1/problem';
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

@Injectable()
export class ShareLinksService {
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
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<ShareLinkDocument>> {
    if (ctx.isAdmin) return {};

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

    const link: ShareLinkDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      token: randomBytes(TOKEN_BYTES).toString('base64url'),
      kind: body.kind,
      subject: { type: body.subject.type, id: body.subject.id },
      range: rangeOf(body.range),
      // A link carries no pictures unless it was made to: the quiet direction is
      // the one a link that says nothing takes.
      includeCameras: body.includeCameras ?? false,
      createdBy,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
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
    await this.require(ctx, id);

    const changes = {
      ...(body.range === undefined ? {} : { range: rangeOf(body.range) }),
      ...(body.includeCameras === undefined ? {} : { includeCameras: body.includeCameras }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }),
    };

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
   * The counters are moved on the way past. They are the owner's only sign that
   * a link is being read at all, so a read that does not move them is a read
   * they never see.
   */
  public async open(token: string, now: Date = new Date()): Promise<ShareLinkDocument> {
    const link = await this.shareLinks.findOne({ token }).lean<ShareLinkDocument>();
    if (!link || link.revokedAt !== null || (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime())) {
      throw notFound('share_link_not_found', 'That link leads nowhere.');
    }

    await this.shareLinks.updateOne({ id: link.id }, { $inc: { 'state.openCount': 1 }, $set: { 'state.lastOpenedAt': now } });
    return link;
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

  /** A link belongs to somebody, and a demo session is nobody. */
  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'This route is about an account, and a demo session is not one.');

    return ctx.userId;
  }
}

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
