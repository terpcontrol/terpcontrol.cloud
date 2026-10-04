import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';

/**
 * Who is told about something that happened in a place.
 *
 * `access()` answers whether one person may read one thing, which is the wrong
 * way round for a notification: here the thing is known and the people are not.
 * The rule is the same one, read from the other end - a space's owner and
 * everybody a membership puts in it, a membership on a room counting for the
 * spaces standing in it - so nobody is told about a tent they could not have
 * opened.
 *
 * A demo object tells nobody but its owner, which it already does: a demo
 * session is not a person and holds no membership.
 */
@Injectable()
export class RecipientsService {
  constructor(
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
  ) {}

  public async forSpace(spaceId: string): Promise<string[]> {
    const space = await this.spaces.findOne({ id: spaceId }, { id: 1, ownerId: 1, roomId: 1 }).lean<SpaceDocument>();
    if (!space) return [];

    // A membership on the room this space hangs in covers the space, so both
    // are asked about.
    const covering = [space.id, ...(space.roomId ? [space.roomId] : [])];
    const members = await this.memberships.find({ spaceId: { $in: covering } }, { userId: 1 }).lean<Pick<MembershipDocument, 'userId'>[]>();

    return [...new Set([space.ownerId, ...members.map(member => member.userId)])];
  }

  /** A grow is kept by whoever keeps the places its plants are standing in, and by its owner. */
  public async forGrow(growId: string): Promise<string[]> {
    const grow = await this.grows.findOne({ id: growId }, { ownerId: 1, placements: 1 }).lean<GrowDocument>();
    if (!grow) return [];

    const here = grow.placements.filter(placement => placement.endedAt === null && placement.spaceId);
    const perSpace = await Promise.all(here.map(placement => this.forSpace(placement.spaceId!)));

    return [...new Set([grow.ownerId, ...perSpace.flat()])];
  }

  /** A device is told about through the tent it stands in; one standing nowhere has only its owner. */
  public async forDevice(deviceId: string): Promise<string[]> {
    const device = await this.devices.findOne({ id: deviceId }, { ownerId: 1, spaceId: 1 }).lean<StoredDevice>();
    if (!device?.ownerId) return [];

    const inSpace = device.spaceId ? await this.forSpace(device.spaceId) : [];
    return [...new Set([device.ownerId, ...inSpace])];
  }

  public async forCamera(cameraId: string): Promise<string[]> {
    const camera = await this.cameras.findOne({ id: cameraId }, { ownerId: 1, spaceId: 1 }).lean<CameraDocument>();
    if (!camera) return [];

    const inSpace = camera.spaceId ? await this.forSpace(camera.spaceId) : [];
    return [...new Set([camera.ownerId, ...inSpace])];
  }
}
