import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { Follow } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, forbidden } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { FollowDocument } from '@database/schemas/v1/follows.schema';
import { GrowsService } from '../grow/grows.service';

/**
 * The `follows` collection: one person, one public grow, and nothing else.
 *
 * A follow says only that somebody wants to keep seeing a diary, so it carries
 * nothing of its own and both routes that write one carry no body. What a
 * follower actually sees is the grow's public page and no more than that, which
 * is why only a public grow can be followed: following a private one would put
 * a card on the home screen that its reader may not open.
 */
@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(MODEL_V1.follow) private readonly follows: Model<FollowDocument>,
    private readonly grows: GrowsService,
    private readonly access: AccessService,
  ) {}

  /** Newest first, which is the order the home screen lists them in. */
  public async list(ctx: AccessContext, query: PageQuery): Promise<CursorPage<Follow>> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged: the cursor is an `$or` of its own, and one
    // spread beside another condition is how a list starts answering rows that
    // are nobody's business from the second page on.
    const conditions: FilterQuery<FollowDocument>[] = [{ userId: this.accountOf(ctx) }, afterCursor('createdAt', query.cursor)];

    const rows = await this.follows.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<FollowDocument[]>();

    const page = pageOf(rows, limit, follow => ({ at: follow.createdAt, id: follow.id }));
    return { items: page.items.map(serialise), nextCursor: page.nextCursor };
  }

  /**
   * Following, which is idempotent: the route is a `PUT` because a follow is a
   * state rather than an event, and tapping the button twice is one follow.
   */
  public async follow(ctx: AccessContext, growId: string): Promise<Follow> {
    const userId = this.accountOf(ctx);

    // Asked first, so that a grow this person may not see at all is not there
    // rather than refused: a refusal would say it exists.
    await this.access.require(ctx, subjectRef('grow', growId), 'view');

    const grow = await this.grows.require(growId);
    if (grow.visibility !== 'public') {
      throw conflict('grow_not_public', 'That grow has no public page, and a follow is a public page somebody keeps reading.');
    }

    const existing = await this.follows.findOne({ userId, growId }).lean<FollowDocument>();
    if (existing) return serialise(existing);

    const follow: FollowDocument = { id: uuidv4(), userId, growId, createdAt: new Date() };
    await this.follows.create(follow);

    return serialise(follow);
  }

  /**
   * Unfollowing. It asks nothing of the grow: a grow that has been made private,
   * or deleted, is exactly the one somebody wants to stop following, and a
   * refusal here would leave the row where it is.
   */
  public async unfollow(ctx: AccessContext, growId: string): Promise<void> {
    await this.follows.deleteOne({ userId: this.accountOf(ctx), growId });
  }

  /** A follow belongs to somebody, and a demo session is nobody. */
  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'This route is about an account, and a demo session is not one.');

    return ctx.userId;
  }
}

const serialise = (follow: FollowDocument): Follow => ({
  id: follow.id,
  userId: follow.userId,
  growId: follow.growId,
  createdAt: follow.createdAt.toISOString(),
});
