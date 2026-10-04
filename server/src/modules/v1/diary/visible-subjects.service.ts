import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { AccessContext } from '@common/v1/access.types';
import { MODEL_V1 } from '@database/models';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { GrowsService } from '../grow/grows.service';
import { SpacesService } from '../space/spaces.service';

/**
 * The grows and the spaces a list may be built from when nothing names one.
 *
 * A reminder and a derived task are each about a grow or a space, and neither
 * is a document `access()` can be asked about - a task is not stored at all.
 * So the decision is taken from the other end, as the alerts inbox takes it:
 * the places this person keeps are worked out first, and the answer is held to
 * them.
 *
 * A demo session, a share link and a public reader get nothing here. They are
 * let in to look at one tent or one diary, and a list of everything that is due
 * is not that - which is what keeps a shared tent page free of tasks.
 */

export interface VisibleSubjects {
  spaceIds: string[];
  growIds: string[];
}

const NOTHING: VisibleSubjects = { spaceIds: [], growIds: [] };

@Injectable()
export class VisibleSubjectsService {
  constructor(
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly places: SpacesService,
    private readonly growing: GrowsService,
  ) {}

  /** Everything this account owns or is a member of, archived and ended included. */
  public subjectsOf(ctx: AccessContext): Promise<VisibleSubjects> {
    return this.resolve(ctx, {}, {});
  }

  /**
   * The same, narrowed to what somebody is actually working in: an archived
   * space is a tombstone history still names, and a grow that has ended is
   * over. Neither is a place work can fall due in, and a task that cannot be
   * done is noise on a card nobody can clear.
   */
  public workedInBy(ctx: AccessContext): Promise<VisibleSubjects> {
    return this.resolve(ctx, { archivedAt: null }, { endedAt: null });
  }

  private async resolve(ctx: AccessContext, space: FilterQuery<SpaceDocument>, grow: FilterQuery<GrowDocument>): Promise<VisibleSubjects> {
    if (!ctx.userId || ctx.isDemo || ctx.shareToken) return NOTHING;

    const [spaces, grows] = await Promise.all([
      this.spaces.find({ $and: [await this.places.visibleTo(ctx), space] }, { id: 1 }).lean<Pick<SpaceDocument, 'id'>[]>(),
      this.grows.find({ $and: [await this.growing.visibleTo(ctx), grow] }, { id: 1 }).lean<Pick<GrowDocument, 'id'>[]>(),
    ]);

    return { spaceIds: spaces.map(row => row.id), growIds: grows.map(row => row.id) };
  }
}
