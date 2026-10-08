import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { Follow } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, findPage, mapPage } from '@common/v1/pages';
import { conflict } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { FollowDocument } from '@database/schemas/v1/follows.schema';
import { accountOf } from '../caller';
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
    return mapPage(await findPage(this.follows, [{ userId: accountOf(ctx) }], query), serialise);
  }

  /**
   * Following, which is idempotent: the route is a `PUT` because a follow is a
   * state rather than an event, and tapping the button twice is one follow.
   */
  public async follow(ctx: AccessContext, growId: string): Promise<Follow> {
    const userId = accountOf(ctx);

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
    await this.follows.deleteOne({ userId: accountOf(ctx), growId });
  }
}

const serialise = (follow: FollowDocument): Follow => ({
  id: follow.id,
  userId: follow.userId,
  growId: follow.growId,
  createdAt: follow.createdAt.toISOString(),
});
