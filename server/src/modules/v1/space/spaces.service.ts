import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AccessNeed, Device, ProblemError, Space, SpaceCreate, SpaceUpdate } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, findPage, mapPage } from '@common/v1/pages';
import { conflict, notFound, unprocessable } from '@common/v1/problem';
import { namedLike, refuseTakenName } from '@common/v1/space-names';
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
import { accountOf } from '../caller';

/**
 * The `spaces` collection: the places a person grows in, and what stands in one.
 *
 * A space is little more than a kind, a name and the room it hangs in, but it is
 * what everything else is grouped by - a card on the home screen, a membership,
 * a share link and the place a grow stands in all address a space - so a space
 * outlives what it held: history names it, and it is archived rather than
 * removed.
 *
 * A room is a space of kind `room` and not a second collection, because a
 * membership and an invite on it cover the places in it. The grouping is one
 * level deep in both directions: a room holds spaces, a room never hangs in one.
 * To a client it is a field of the place: a place names its room (`roomId`, or
 * `roomName` for one that may not exist yet), the server makes it, and ends it
 * once its last place and its last member have left. Nobody makes, ends or
 * brings back a room by itself.
 */

/** What a room is refused: every act that would treat it as a place of its own. */
const roomByItself = (detail: string) =>
  conflict('room_by_itself', 'A room is a field of the places standing in it.', [{ field: 'kind', code: 'not_allowed', detail }]);

/** What a list of spaces narrows by. Neither is a page of its own, so both are query parameters. */
interface SpaceFilter {
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

  public async require(id: string): Promise<SpaceDocument> {
    const space = await this.spaces.findOne({ id }).lean<SpaceDocument>();
    if (!space) throw notFound('space_not_found', 'There is no space with that id.');

    return space;
  }

  /**
   * Oldest first: a list of spaces is a list of places and not a feed, so it
   * reads in the order they were set up - a room before the tents somebody put
   * in it - and that order does not change under a reader.
   */
  public async list(ctx: AccessContext, query: PageQuery, filter: SpaceFilter): Promise<CursorPage<Space>> {
    const conditions: FilterQuery<SpaceDocument>[] = [
      await this.visibleTo(ctx),
      { archivedAt: filter.archived ? { $ne: null } : null },
      ...(filter.roomId ? [{ roomId: filter.roomId }] : []),
    ];

    const page = await findPage(this.spaces, conditions, query, { order: 'asc' });
    const may = await this.mayIn(ctx, page.items);
    return mapPage(page, space => this.serialise(space, may.get(space.id)));
  }

  /**
   * The spaces a caller may see at all, as one filter rather than a decision per
   * row: their own, those they are a member of, and those inside a room they are
   * a member of - the widening `access()` does for every other subject.
   *
   * The one widening it does not copy is the administrator's. `access()` lets
   * the office at any named space, and should; but this filter answers the
   * lists a person reads about their own places, and an operator's home screen
   * is not the whole install. Fleet work has its own screens under `/admin`.
   */
  public async visibleTo(ctx: AccessContext): Promise<FilterQuery<SpaceDocument>> {
    if (ctx.isDemo || ctx.userId === null) return { isDemo: true };

    const rows = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean();
    const spaceIds = rows.map(row => row.spaceId);
    if (spaceIds.length === 0) return { ownerId: ctx.userId };

    return { $or: [{ ownerId: ctx.userId }, { id: { $in: spaceIds } }, { roomId: { $in: spaceIds } }] };
  }

  public async create(ctx: AccessContext, body: SpaceCreate): Promise<Space> {
    const userId = accountOf(ctx, 'A space belongs to somebody, and this session is nobody.');

    if (body.kind === 'room') throw roomByItself('Name the room on a place (`roomName`); the server makes it.');
    this.refuseTwoRooms(body);
    const name = nameOf(body.name);
    const named = body.roomId ? await this.requireRoom(ctx, body.roomId) : null;
    // A space made in a room belongs to whoever owns the room, so that a
    // club's rooms stay whole when one of its managers adds a tent.
    const ownerId = named?.ownerId ?? userId;
    await refuseTakenName(this.spaces, ownerId, body.kind, name);
    const room = named ?? (body.roomName === undefined ? null : await this.roomNamed(ownerId, body.roomName));
    const space = await this.spaces.create({
      id: uuidv4(),
      ownerId,
      kind: body.kind,
      name,
      roomId: room?.id ?? null,
      presetPrompt: body.presetPrompt ?? 'ask',
      retention: { climateDays: body.retention?.climateDays ?? null },
      isDemo: false,
      archivedAt: null,
      createdAt: new Date(),
    });

    // Whoever made it may do everything in it - except in somebody else's room,
    // where it was made for the room's owner and the maker keeps the role the
    // room gave them.
    const made = space.toObject<SpaceDocument>();
    return this.serialise(made, await this.mayIn1(ctx, made));
  }

  public async update(ctx: AccessContext, id: string, body: SpaceUpdate): Promise<Space> {
    const space = await this.require(id);
    const kind = body.kind ?? space.kind;
    if ((kind === 'room') !== (space.kind === 'room')) throw roomByItself('A place does not become a room, nor a room a place.');
    this.refuseTwoRooms(body);
    // The grouping is one level deep in both directions: a room holds spaces, a room never hangs in one.
    if (kind === 'room' && (body.roomName !== undefined || (body.roomId ?? null) !== null)) {
      throw unprocessable('room_in_room', 'A room groups spaces; it does not stand in one.', [
        { field: 'roomId', code: 'not_allowed', detail: 'A space of kind `room` hangs in no room.' },
      ]);
    }

    const name = body.name === undefined ? undefined : nameOf(body.name);
    if (name !== undefined) await refuseTakenName(this.spaces, space.ownerId, kind, name, id);

    if (body.roomId && body.roomId !== space.roomId) {
      const room = await this.requireRoom(ctx, body.roomId, id);
      // A room and the spaces in it belong to one account: the grouping is what
      // its owner shares, and a space of somebody else's in it would be theirs alone.
      if (room.ownerId !== space.ownerId) {
        throw conflict('room_of_another_account', 'A space is grouped by a room of the same account.');
      }
    }
    const roomId = body.roomName === undefined ? body.roomId : (await this.roomNamed(space.ownerId, body.roomName)).id;

    const changes = {
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(name === undefined ? {} : { name }),
      ...(roomId === undefined ? {} : { roomId }),
      ...(body.presetPrompt === undefined ? {} : { presetPrompt: body.presetPrompt }),
      ...(body.retention === undefined ? {} : { retention: { climateDays: body.retention.climateDays } }),
    };

    const changed = await this.spaces.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<SpaceDocument>();
    if (!changed) throw notFound('space_not_found', 'There is no space with that id.');
    if (changed.roomId !== space.roomId) await this.endRoomIfEmpty(space.roomId);

    return this.serialise(changed, await this.mayIn1(ctx, changed));
  }

  /** A room is named by its id or by its name, never both: two statements about one field can disagree. */
  private refuseTwoRooms(body: Pick<SpaceUpdate, 'roomId' | 'roomName'>): void {
    if (body.roomName !== undefined && body.roomId !== undefined) {
      throw unprocessable('two_rooms', 'Name the room by `roomId` or by `roomName`, not both.', [
        { field: 'roomName', code: 'exclusive', detail: 'Leave `roomId` out where `roomName` is given.' },
      ]);
    }
  }

  /**
   * The owner's room of that name, made where there is none. Typing the name of
   * a room that exists is choosing it, so a second room of one name is never
   * made this way and nothing has to be refused.
   */
  private async roomNamed(ownerId: string, wanted: string): Promise<SpaceDocument> {
    const name = nameOf(wanted, 'roomName');
    const room = await namedLike(this.spaces, ownerId, 'room', name);
    if (room) return room;

    const made = await this.spaces.create({
      id: uuidv4(),
      ownerId,
      kind: 'room',
      name,
      roomId: null,
      presetPrompt: 'ask',
      retention: { climateDays: null },
      isDemo: false,
      archivedAt: null,
      createdAt: new Date(),
    });
    return made.toObject<SpaceDocument>();
  }

  /**
   * Ends a room nothing is left in: no place that has not ended, nobody who is
   * a member of it, and nothing standing in it itself. It goes the way a deleted
   * place goes - a tombstone history can still name, its invites and share
   * links gone. A room people are still members of stays until they have left.
   */
  public async endRoomIfEmpty(roomId: string | null): Promise<void> {
    if (roomId === null) return;
    const room = await this.spaces.findOne({ id: roomId, kind: 'room', archivedAt: null }).lean<SpaceDocument>();
    if (!room) return;

    const kept =
      (await this.spaces.exists({ roomId, archivedAt: null })) ??
      (await this.memberships.exists({ spaceId: roomId })) ??
      (await this.deviceRows.exists({ spaceId: roomId })) ??
      (await this.cameras.exists({ spaceId: roomId, removedAt: null })) ??
      (await this.grows.exists({ endedAt: null, placements: { $elemMatch: { spaceId: roomId, endedAt: null } } }));
    if (kept) return;

    await this.spaces.updateOne({ id: roomId }, { $set: { archivedAt: new Date() } });
    // The ended places still naming it stand in no room: brought back, they must not hang in one that is gone.
    await this.spaces.updateMany({ roomId }, { $set: { roomId: null } });
    await this.invites.deleteMany({ spaceId: roomId });
    await this.shareLinks.deleteMany({ 'subject.type': 'space', 'subject.id': roomId });
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
  public async archive(ctx: AccessContext, id: string, archived: boolean): Promise<Space> {
    const space = await this.require(id);
    if (space.kind === 'room') throw roomByItself('A room ends with its last place and its last member, and is not put away or brought back.');
    if (archived === (space.archivedAt !== null)) return this.serialise(space, await this.mayIn1(ctx, space));
    // A place that comes back is one of the owner's places again, and may not take a name another carries by now.
    if (!archived) await refuseTakenName(this.spaces, space.ownerId, space.kind, space.name, id);

    const changed = await this.spaces
      .findOneAndUpdate({ id }, { $set: { archivedAt: archived ? new Date() : null } }, { new: true })
      .lean<SpaceDocument>();
    if (!changed) throw notFound('space_not_found', 'There is no space with that id.');
    if (archived) await this.endRoomIfEmpty(space.roomId);

    return this.serialise(changed, await this.mayIn1(ctx, changed));
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
    if (space.kind === 'room') throw roomByItself('A room ends by itself once its last place and its last member have left.');
    await this.refuseWhileOccupied(space);

    await this.spaces.updateOne({ id }, { $set: { archivedAt: space.archivedAt ?? new Date() } });
    await this.invites.deleteMany({ spaceId: id });
    await this.shareLinks.deleteMany({ 'subject.type': 'space', 'subject.id': id });
    await this.endRoomIfEmpty(space.roomId);
  }

  /**
   * A space is only ended once nothing stands in it and nobody else is in it,
   * and the refusal says which: a place that is deleted out from under a running
   * grow takes the grow's own history with it, and one deleted out from under
   * the people sharing it takes theirs.
   *
   * The members counted are this space's own rows. A membership held on the room
   * above reaches in here as well, but it is the room's, and the room stays for
   * as long as anybody is a member of it.
   */
  private async refuseWhileOccupied(space: SpaceDocument): Promise<void> {
    const errors: ProblemError[] = [];

    if (await this.deviceRows.exists({ spaceId: space.id })) {
      errors.push({ field: 'id', code: 'device_here', detail: 'A device stands in this space. Move it somewhere else first.' });
    }
    if (await this.cameras.exists({ spaceId: space.id, removedAt: null })) {
      errors.push({ field: 'id', code: 'camera_here', detail: 'A camera looks into this space. Move it somewhere else first.' });
    }
    // An ended grow may keep the placement it ended in open, as the record of where it stood last; it names
    // the place in its history the way every entry does, which the kept row still answers.
    if (await this.grows.exists({ endedAt: null, placements: { $elemMatch: { spaceId: space.id, endedAt: null } } })) {
      errors.push({ field: 'id', code: 'grow_here', detail: 'A grow stands in this space. Move it or end it first.' });
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

  /**
   * What the caller may do in each of these places, in one query rather than one
   * per row. A membership on the room counts for every tent in it, and a tent's
   * own row wins where it is the stronger of the two, which is what `access()`
   * decides by and what this has to agree with exactly - a screen that is told
   * more than the server will allow is worse than one that is told nothing.
   */
  private async mayIn(ctx: AccessContext, spaces: SpaceDocument[]): Promise<Map<string, AccessNeed>> {
    const may = new Map<string, AccessNeed>();
    if (spaces.length === 0) return may;

    const userId = ctx.isDemo ? null : ctx.userId;
    if (ctx.isAdmin) {
      for (const space of spaces) may.set(space.id, 'own');
      return may;
    }

    const covering = [...new Set(spaces.flatMap(space => [space.id, space.roomId]).filter((id): id is string => id !== null))];
    const rows =
      userId === null
        ? []
        : await this.memberships
            .find({ userId, spaceId: { $in: covering } }, { spaceId: 1, role: 1 })
            .lean<Pick<MembershipDocument, 'spaceId' | 'role'>[]>();
    const roles = new Map(rows.map(row => [row.spaceId, row.role]));

    for (const space of spaces) {
      if (userId !== null && space.ownerId === userId) {
        may.set(space.id, 'own');
        continue;
      }

      const here = [roles.get(space.id), space.roomId === null ? undefined : roles.get(space.roomId)];
      may.set(space.id, here.includes('can_manage') ? 'manage' : here.includes('can_log') ? 'log' : 'view');
    }

    return may;
  }

  /** What one caller may do in one place, for the routes that answer a single space. */
  public async mayIn1(ctx: AccessContext, space: SpaceDocument): Promise<AccessNeed> {
    return (await this.mayIn(ctx, [space])).get(space.id) ?? 'view';
  }

  /** Field by field, because `_id` rides on a stored document and never leaves the server. */
  public serialise(space: SpaceDocument, youMay: AccessNeed = 'view'): Space {
    return {
      id: space.id,
      ownerId: space.ownerId,
      youMay,
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

/** A name as it is stored: without the blanks around it, and never empty. */
const nameOf = (name: string, field: 'name' | 'roomName' = 'name'): string => {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed === '')
    throw unprocessable('name_required', 'A name is at least one character.', [{ field, code: 'required', detail: 'Type a name.' }]);

  return trimmed;
};
