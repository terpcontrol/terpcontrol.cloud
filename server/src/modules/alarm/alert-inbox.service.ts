import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { AccessContext, SubjectRef } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageOf, readLimit } from '@common/v1/pages';
import { notFound } from '@common/v1/problem';

/**
 * Reading alerts, which is the inbox and the badge on a card.
 *
 * One alert is decided by what it is about - `AccessService` answers for the
 * device, the camera or the space it names. A list has no such subject, so it is
 * the other way round: the places a person can see are worked out first and the
 * query is held to them.
 */

export interface AlertFilter {
  deviceId?: string;
  spaceId?: string;
  /** True lists what is still open, false what is over, absent both. */
  open?: boolean;
}

@Injectable()
export class AlertInboxService {
  constructor(
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
  ) {}

  public async byId(id: string): Promise<StoredAlert> {
    const alert = await this.alerts.findOne({ id }).lean<StoredAlert>();
    if (!alert) throw notFound('alert_not_found', 'There is no alert with that id.');

    return alert;
  }

  /** What one alert is about, which is what may be read to decide whether it may be read. */
  public subjectOf(alert: StoredAlert): SubjectRef | null {
    if (alert.deviceId) return { type: 'device', id: alert.deviceId };
    if (alert.cameraId) return { type: 'camera', id: alert.cameraId };
    if (alert.spaceId) return { type: 'space', id: alert.spaceId };

    return null;
  }

  public async list(where: FilterQuery<StoredAlert>, cursor: string | undefined, limit: number): Promise<CursorPage<StoredAlert>> {
    const rows = await this.alerts
      .find({ ...where, ...afterCursor('startedAt', cursor) })
      .sort({ startedAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<StoredAlert[]>();

    return pageOf(rows, limit, alert => ({ at: alert.startedAt, id: alert.id }));
  }

  /** The filter a list is held to, or null where the caller can see nothing at all. */
  public async scope(ctx: AccessContext, filter: AlertFilter): Promise<FilterQuery<StoredAlert> | null> {
    const where: FilterQuery<StoredAlert> = {};
    if (filter.deviceId) where.deviceId = filter.deviceId;
    if (filter.spaceId) where.spaceId = filter.spaceId;
    if (filter.open !== undefined) where.resolvedAt = filter.open ? null : { $ne: null };

    // A named subject has been decided on by `AccessService` already; an
    // unnamed one is every place this person can see.
    if (ctx.isAdmin || filter.deviceId || filter.spaceId) return where;

    const spaceIds = await this.spaceIdsVisibleTo(ctx);
    return spaceIds.length > 0 ? { ...where, spaceId: { $in: spaceIds } } : null;
  }

  /**
   * The spaces a person owns or is a member of, a membership on a room counting
   * for the spaces in it. A demo session and a share link have no inbox: they
   * are let in to look at one thing, not at everything a list would answer.
   */
  private async spaceIdsVisibleTo(ctx: AccessContext): Promise<string[]> {
    if (!ctx.userId || ctx.isDemo) return [];

    const owned = await this.spaces.find({ ownerId: ctx.userId }, { id: 1 }).lean<{ id: string }[]>();
    const memberships = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean<{ spaceId: string }[]>();

    const ids = new Set([...owned.map(space => space.id), ...memberships.map(membership => membership.spaceId)]);
    const inRooms = await this.spaces.find({ roomId: { $in: [...ids] } }, { id: 1 }).lean<{ id: string }[]>();
    for (const space of inRooms) ids.add(space.id);

    return [...ids];
  }
}
