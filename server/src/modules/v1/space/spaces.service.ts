import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Device, ProblemError, Space, SpaceCreate, SpaceKind, SpaceUpdate } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound, unprocessable } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { InviteDocument } from '@database/schemas/v1/invites.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { DevicesService } from '../device/devices.service';

/**
 * The `spaces` collection: the places a person grows in, and what stands in one.
 *
 * A space is little more than a kind, a name and the room it hangs in, but it is
 * what everything else is grouped by - a card on the home screen, a membership,
 * a share link and the place a grow stands in all address a space - so a space
 * outlives what it held: history names it, and it is archived rather than
 * removed.
 *
 * A room is a space of kind `room` and not a second collection. The grouping is
 * one level deep in both directions: a room holds spaces, a room never hangs in
 * one.
 */

/** What a list of spaces narrows by. Neither is a page of its own, so both are query parameters. */
export interface SpaceFilter {
  roomId?: string;
  /** Archived spaces are their own list: a tombstone is never mixed into the places somebody is growing in. */
  archived?: boolean;
}

@Injectable()
export class SpacesService {
  constructor(
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.invite) private readonly invites: Model<InviteDocument>,
    @InjectModel(MODEL_V1.shareLink) private readonly shareLinks: Model<ShareLinkDocument>,
    // Read, never written, and each is the collection that carries the pointer:
    // a device and a camera name the space they stand in, a grow names it in a
    // placement. What may be deleted is decided from the pointers themselves.
    @InjectModel(MODEL_V1.device) private readonly deviceRows: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    private readonly devices: DevicesService,
    private readonly access: AccessService,
  ) {}

  public byId(id: string): Promise<SpaceDocument | null> {
    return this.spaces.findOne({ id }).lean<SpaceDocument>();
  }

  public async require(id: string): Promise<SpaceDocument> {
    const space = await this.byId(id);
    if (!space) throw notFound('space_not_found', 'There is no space with that id.');

    return space;
  }

  /**
   * Oldest first: a list of spaces is a list of places and not a feed, so it
   * reads in the order they were set up - a room before the tents somebody put
   * in it - and that order does not change under a reader.
   */
  public async list(ctx: AccessContext, query: PageQuery, filter: SpaceFilter): Promise<CursorPage<Space>> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged into one object: the visibility and the cursor
    // are each an `$or` of their own, and one would silently replace the other.
    const conditions: FilterQuery<SpaceDocument>[] = [
      await this.visibleTo(ctx),
      { archivedAt: filter.archived ? { $ne: null } : null },
      ...(filter.roomId ? [{ roomId: filter.roomId }] : []),
      afterCursor('createdAt', query.cursor, 'asc'),
    ];

    const rows = await this.spaces.find({ $and: conditions }).sort({ createdAt: 1, id: 1 }).limit(readLimit(limit)).lean<SpaceDocument[]>();

    const page = pageOf(rows, limit, space => ({ at: space.createdAt, id: space.id }));
    return { items: page.items.map(space => this.serialise(space)), nextCursor: page.nextCursor };
  }

  /**
   * The spaces a caller may see at all, as one filter rather than a decision per
   * row: their own, those they are a member of, and those inside a room they are
   * a member of - the widening `access()` does for every other subject.
   */
  public async visibleTo(ctx: AccessContext): Promise<FilterQuery<SpaceDocument>> {
    if (ctx.isAdmin) return {};
    if (ctx.isDemo || ctx.userId === null) return { isDemo: true };

    const rows = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean();
    const spaceIds = rows.map(row => row.spaceId);
    if (spaceIds.length === 0) return { ownerId: ctx.userId };

    return { $or: [{ ownerId: ctx.userId }, { id: { $in: spaceIds } }, { roomId: { $in: spaceIds } }] };
  }

  public async create(ctx: AccessContext, body: SpaceCreate): Promise<Space> {
    const userId = ctx.userId;
    if (!userId || ctx.isDemo) throw conflict('no_account', 'A space belongs to somebody, and this session is nobody.');

    this.refuseRoomInRoom(body.kind, body.roomId ?? null);
    const room = body.roomId ? await this.requireRoom(ctx, body.roomId) : null;
    const space = await this.spaces.create({
      id: uuidv4(),
      // A space made in a room belongs to whoever owns the room, so that a
      // club's rooms stay whole when one of its managers adds a tent.
      ownerId: room?.ownerId ?? userId,
      kind: body.kind,
      name: body.name,
      roomId: room?.id ?? null,
      presetPrompt: body.presetPrompt ?? 'ask',
      retention: { climateDays: body.retention?.climateDays ?? null },
      isDemo: false,
      archivedAt: null,
      createdAt: new Date(),
    });

    return this.serialise(space.toObject<SpaceDocument>());
  }

  public async update(ctx: AccessContext, id: string, body: SpaceUpdate): Promise<Space> {
    const space = await this.require(id);
    const kind = body.kind ?? space.kind;
    const roomId = body.roomId === undefined ? space.roomId : body.roomId;

    // Asked of what the space will be, not of what changed: becoming a room and
    // hanging in one are each allowed alone and never together.
    this.refuseRoomInRoom(kind, roomId);

    if (kind !== 'room' && space.kind === 'room' && (await this.spaces.exists({ roomId: id }))) {
      throw conflict('room_not_empty', 'Spaces are grouped under this room. Move them out before it stops being one.');
    }

    if (roomId !== null && roomId !== space.roomId) {
      const room = await this.requireRoom(ctx, roomId, id);
      // A room and the spaces in it belong to one account: the grouping is what
      // its owner shares and deletes, and a space of somebody else's in it would
      // be theirs alone.
      if (room.ownerId !== space.ownerId) {
        throw conflict('room_of_another_account', 'A space is grouped by a room of the same account.');
      }
    }

    const changes = {
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.roomId === undefined ? {} : { roomId: body.roomId }),
      ...(body.presetPrompt === undefined ? {} : { presetPrompt: body.presetPrompt }),
      ...(body.retention === undefined ? {} : { retention: { climateDays: body.retention.climateDays } }),
    };

    const changed = await this.spaces.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<SpaceDocument>();
    if (!changed) throw notFound('space_not_found', 'There is no space with that id.');

    return this.serialise(changed);
  }

  /** The grouping is one level deep in both directions: a room holds spaces, a room never hangs in one. */
  private refuseRoomInRoom(kind: SpaceKind, roomId: string | null): void {
    if (kind === 'room' && roomId !== null) {
      throw unprocessable('room_in_room', 'A room groups spaces; it does not stand in one.', [
        { field: 'roomId', code: 'not_allowed', detail: 'A space of kind `room` hangs in no room.' },
      ]);
    }
  }

  /**
   * Hanging a space in a room is managing that room, which the guard on the
   * route has not decided about: it was asked about the space being moved.
   */
  private async requireRoom(ctx: AccessContext, roomId: string, movedId?: string): Promise<SpaceDocument> {
    if (roomId === movedId) {
      throw unprocessable('room_in_room', 'A space cannot be grouped by itself.', [
        { field: 'roomId', code: 'not_allowed', detail: 'Name another space of kind `room`.' },
      ]);
    }

    await this.access.require(ctx, subjectRef('space', roomId), 'manage');
    const room = await this.require(roomId);
    if (room.kind !== 'room') {
      throw unprocessable('not_a_room', 'Spaces are grouped by a space of kind `room`.', [
        { field: 'roomId', code: 'not_a_room', detail: `That space is a ${room.kind}.` },
      ]);
    }

    return room;
  }

  /**
   * Archiving is what happens to a place somebody has stopped using: it leaves
   * every list and stays readable wherever history names it. The route is
   * idempotent, so archiving twice does not move the instant it carries.
   */
  public async archive(id: string, archived: boolean): Promise<Space> {
    const space = await this.require(id);
    if (archived === (space.archivedAt !== null)) return this.serialise(space);

    // A room whose spaces are still in use would leave the home screen with a
    // group whose room is gone, so it is emptied or archived with them.
    if (archived && space.kind === 'room' && (await this.spaces.exists({ roomId: id, archivedAt: null }))) {
      throw conflict('room_not_empty', 'Spaces are grouped under this room. Archive or move them first.');
    }

    const changed = await this.spaces
      .findOneAndUpdate({ id }, { $set: { archivedAt: archived ? new Date() : null } }, { new: true })
      .lean<SpaceDocument>();
    if (!changed) throw notFound('space_not_found', 'There is no space with that id.');

    return this.serialise(changed);
  }

  /**
   * Deleting ends the space for clients without removing the row: an entry, a
   * picture and a grow that once stood here still name it, and a list with a
   * dangling name in it is worse than a place nobody can reach any more. What
   * does go is the rest of the way in - an invite and a share link on a space
   * that has ended are each a key to somebody's history that nothing would ever
   * turn again.
   *
   * The people are not among them. A space with members is refused until they
   * have been let go one at a time, so that ending a place is never how somebody
   * finds out they were thrown out of it.
   */
  public async remove(id: string): Promise<void> {
    const space = await this.require(id);
    await this.refuseWhileOccupied(space);

    await this.spaces.updateOne({ id }, { $set: { archivedAt: space.archivedAt ?? new Date() } });
    await this.invites.deleteMany({ spaceId: id });
    await this.shareLinks.deleteMany({ 'subject.type': 'space', 'subject.id': id });
  }

  /**
   * A space is only ended once nothing stands in it and nobody else is in it,
   * and the refusal says which: a place that is deleted out from under a running
   * grow takes the grow's own history with it, and one deleted out from under
   * the people sharing it takes theirs.
   *
   * The members counted are this space's own rows. A membership held on the room
   * above reaches in here as well, but it is the room's to end, and a room is
   * already refused while any space is grouped under it - so a shared room is
   * emptied first and then meets its own members, rather than making every tent
   * inside it undeletable.
   */
  private async refuseWhileOccupied(space: SpaceDocument): Promise<void> {
    const errors: ProblemError[] = [];

    if (await this.deviceRows.exists({ spaceId: space.id })) {
      errors.push({ field: 'id', code: 'device_here', detail: 'A device stands in this space. Move it somewhere else first.' });
    }
    if (await this.cameras.exists({ spaceId: space.id, removedAt: null })) {
      errors.push({ field: 'id', code: 'camera_here', detail: 'A camera looks into this space. Move it somewhere else first.' });
    }
    if (await this.grows.exists({ placements: { $elemMatch: { spaceId: space.id, endedAt: null } } })) {
      errors.push({ field: 'id', code: 'grow_here', detail: 'A grow stands in this space. Move it or end it first.' });
    }
    if (await this.spaces.exists({ roomId: space.id })) {
      errors.push({ field: 'id', code: 'space_here', detail: 'Spaces are grouped under this room. Move them out first.' });
    }

    const members = await this.memberships.countDocuments({ spaceId: space.id });
    if (members > 0) {
      errors.push({
        field: 'id',
        code: 'member_here',
        detail:
          members === 1
            ? 'Somebody else is a member of this space. Remove them from it first.'
            : `${members} other people are members of this space. Remove them from it first.`,
      });
    }

    // One refusal listing everything, rather than the first thing in the way:
    // emptying a tent is a round of errands, and being sent back for the next
    // one each time is how somebody gives up half way.
    if (errors.length > 0) throw conflict('space_in_use', 'This space is not ready to be ended.', errors);
  }

  /**
   * Putting a device somewhere, from the space's side. The move itself belongs
   * to the device module, which takes the cameras a controller answers for
   * along with it.
   */
  public async placeDevice(spaceId: string, deviceId: string, redacted: boolean): Promise<Device> {
    const space = await this.require(spaceId);
    if (space.archivedAt !== null) throw conflict('space_archived', 'That space has ended. Bring it back before putting anything in it.');

    return this.devices.serialise(await this.devices.update(deviceId, { spaceId }), redacted);
  }

  /** Taking a device out. It belongs to nowhere until it is put somewhere, which is a state of its own and not a deletion. */
  public async removeDevice(spaceId: string, deviceId: string): Promise<void> {
    const device = await this.devices.require(deviceId);
    if (device.spaceId !== spaceId) throw notFound('device_not_here', 'That device does not stand in this space.');

    await this.devices.update(deviceId, { spaceId: null });
  }

  /** Field by field, because `_id` rides on a stored document and never leaves the server. */
  public serialise(space: SpaceDocument): Space {
    return {
      id: space.id,
      ownerId: space.ownerId,
      kind: space.kind,
      name: space.name,
      roomId: space.roomId,
      presetPrompt: space.presetPrompt,
      retention: { climateDays: space.retention.climateDays },
      isDemo: space.isDemo,
      archivedAt: space.archivedAt?.toISOString() ?? null,
      createdAt: space.createdAt.toISOString(),
    };
  }
}
