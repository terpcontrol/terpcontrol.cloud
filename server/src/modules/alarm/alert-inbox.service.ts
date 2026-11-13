import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { AccessContext, SubjectRef } from '@common/v1/access.types';
import { CursorPage, findPage } from '@common/v1/pages';
import { withSpacesInside } from '@common/v1/rooms';
import { conflict, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';

/**
 * Reading alerts, which is the inbox and the badge on a card.
 *
 * An open alert stands where its device stands - the writer of a device's place
 * moves it along - and one that is over keeps the place it happened in. So one
 * alert is decided by what it is about: `AccessService` answers for the device
 * or the camera of an open one, and for the place of one that is over. A list
 * has no such subject, so it is the other way round: the places a person can
 * see are worked out first and the query is held to them.
 */

interface AlertFilter {
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
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
  ) {}

  public async byId(id: string): Promise<StoredAlert> {
    const alert = await this.alerts.findOne({ id }).lean<StoredAlert>();
    if (!alert) throw notFound('alert_not_found', 'There is no alert with that id.');

    return alert;
  }

  /**
   * What one alert is about, which is what may be read to decide whether it may
   * be read. One that is over is the history of the place it happened in: who
   * sees that place reads it, wherever its device has gone since.
   */
  public subjectOf(alert: StoredAlert): SubjectRef | null {
    if (alert.resolvedAt !== null && alert.spaceId) return { type: 'space', id: alert.spaceId };
    if (alert.deviceId) return { type: 'device', id: alert.deviceId };
    if (alert.cameraId) return { type: 'camera', id: alert.cameraId };
    if (alert.spaceId) return { type: 'space', id: alert.spaceId };

    return null;
  }

  /**
   * Taking an episode that is over off the record. One still open is refused:
   * it is something happening now, and the way to stop hearing about it is to
   * silence, disable or delete the rule that watches it.
   */
  public async remove(alert: StoredAlert): Promise<void> {
    if (alert.resolvedAt === null) throw conflict('alert_open', 'An open alert cannot be deleted. Silence, disable or delete its rule instead.');

    await this.alerts.deleteOne({ id: alert.id });
  }

  /**
   * Newest first - which for a list of what is over (`over`) is by when each
   * ended: the inbox reads them as "ended ... ago", and a long episode that has
   * just ended would otherwise sort pages down, behind short ones that began
   * after it. A list that holds open alerts is by when each began.
   */
  public list(where: FilterQuery<StoredAlert>, query: PageQuery, over = false): Promise<CursorPage<StoredAlert>> {
    return findPage(this.alerts, [where], query, { field: over ? 'resolvedAt' : 'startedAt' });
  }

  /** What the places these alerts name are called now, an ended place included: no reader is to show an id. */
  public async placeNames(alerts: readonly StoredAlert[]): Promise<(alert: StoredAlert) => string | null> {
    const ids = [...new Set(alerts.flatMap(alert => (alert.spaceId ? [alert.spaceId] : [])))];
    const named =
      ids.length === 0 ? [] : await this.spaces.find({ id: { $in: ids } }, { id: 1, name: 1 }).lean<Pick<SpaceDocument, 'id' | 'name'>[]>();
    const names = new Map(named.map(space => [space.id, space.name]));

    return alert => (alert.spaceId ? (names.get(alert.spaceId) ?? null) : null);
  }

  /** The filter a list is held to, or null where the caller can see nothing at all. */
  public async scope(ctx: AccessContext, filter: AlertFilter): Promise<FilterQuery<StoredAlert> | null> {
    const where: FilterQuery<StoredAlert> = {};
    if (filter.deviceId) where.deviceId = filter.deviceId;
    if (filter.spaceId) where.spaceId = filter.spaceId;
    if (filter.open !== undefined) where.resolvedAt = filter.open ? null : { $ne: null };

    // A named place has been decided on by `AccessService` already, and there
    // the office is admin-wide as it should be; an unnamed one is every place
    // this person can see, an administrator's included - the inbox is the
    // reader's own alerts, not the install's.
    const person = ctx.userId !== null && !ctx.isDemo && !ctx.isAdmin;
    if (filter.spaceId || (filter.deviceId && !person)) return where;

    const spaceIds = await this.spaceIdsVisibleTo(ctx);
    // A device is read by whoever sees the place it stands in now; what it raised
    // in a place it has left is that place's past, and theirs only if they see that place too.
    if (filter.deviceId) return { ...where, $or: [{ resolvedAt: null }, { spaceId: null }, { spaceId: { $in: spaceIds } }] };

    const [deviceIds, cameraIds] = await this.heldBy(ctx);
    const seen = [
      ...(spaceIds.length > 0 ? [{ spaceId: { $in: spaceIds } }] : []),
      // One that names no place - its device stands in none - counts by the device, for its owner.
      ...(deviceIds.length > 0 ? [{ spaceId: null, deviceId: { $in: deviceIds } }] : []),
      ...(cameraIds.length > 0 ? [{ spaceId: null, cameraId: { $in: cameraIds } }] : []),
    ];
    return seen.length > 0 ? { ...where, $or: seen } : null;
  }

  private async heldBy(ctx: AccessContext): Promise<[string[], string[]]> {
    if (!ctx.userId || ctx.isDemo) return [[], []];

    const owned = { ownerId: ctx.userId };
    const [deviceIds, cameraIds] = await Promise.all([this.devices.distinct('id', owned), this.cameras.distinct('id', owned)]);
    return [deviceIds as string[], cameraIds as string[]];
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

    return withSpacesInside(this.spaces, [...owned.map(space => space.id), ...memberships.map(membership => membership.spaceId)]);
  }
}
