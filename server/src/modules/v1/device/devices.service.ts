import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AdminDeviceCreate, Device, DeviceClaimCreate, DeviceClaimResult, DeviceUpdate, SpaceKind } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredClaimCode } from '@database/schemas/v1/claim-codes.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { demoDevice } from '@utils/demo';
import { logger } from '@utils/logger';
import { DEVICE_PLACEMENT, DevicePlacement } from './placement.port';

/**
 * The `devices` collection: what a device is, and what a person decides about
 * one.
 *
 * What the device itself says lives under `state` and is nobody's to write from
 * here; what a human thinks about it - the plan, the alarm rules, the camera -
 * is not on the device at all. So this is a short resource: an owner, a place, a
 * name, an update channel and two sensor factors.
 */

/**
 * What kind of place a device of this type stands in, which is as close as the
 * hardware gets to saying: a fridge controller is in a fridge and a tent
 * controller in a tent. Anything else is in something, but nothing says what.
 */
const SPACE_KIND: Readonly<Record<string, SpaceKind>> = { fridge: 'fridge', controller: 'tent' };

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.claimCode) private readonly claimCodes: Model<StoredClaimCode>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.plan) private readonly plans: Model<StoredPlan>,
    @InjectModel(MODEL_V1.alarmRule) private readonly alarmRules: Model<StoredAlarmRule>,
    private readonly access: AccessService,
    @Optional() @Inject(DEVICE_PLACEMENT) private readonly placement: DevicePlacement | null = null,
  ) {}

  public byId(id: string): Promise<StoredDevice | null> {
    return this.devices.findOne({ id }).lean<StoredDevice>();
  }

  public async require(id: string): Promise<StoredDevice> {
    const device = await this.byId(id);
    if (!device) throw notFound('device_not_found', 'There is no device with that id.');

    return device;
  }

  public async list(ctx: AccessContext, query: PageQuery, spaceId?: string): Promise<CursorPage<Device>> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged into one object: the visibility and the cursor
    // are each an `$or` of their own, and one would silently replace the other -
    // which would hand out everything that sorts after the cursor from the
    // second page on, while the first page looked right.
    const conditions: FilterQuery<StoredDevice>[] = [
      await this.visibleTo(ctx),
      ...(spaceId ? [{ spaceId }] : []),
      afterCursor('createdAt', query.cursor),
    ];

    const rows = await this.devices.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<StoredDevice[]>();

    const page = pageOf(rows, limit, device => ({ at: device.createdAt, id: device.id }));
    return { items: page.items.map(device => this.serialise(device, ctx.isDemo)), nextCursor: page.nextCursor };
  }

  /**
   * The devices a caller may see at all, as one filter rather than a decision
   * per row: their own, and those standing in a space they are a member of. An
   * admin sees every device, a demo session the demo ones.
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<StoredDevice>> {
    if (ctx.isAdmin) return {};
    if (ctx.isDemo || ctx.userId === null) return { isDemo: true };

    const rows = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean();
    const held = rows.map(row => row.spaceId);
    if (held.length === 0) return { ownerId: ctx.userId };

    // A membership on a room covers the spaces standing in it, so the rooms are
    // widened to what is inside them before a device is looked for by the space
    // it stands in - which is the rule `access()` decides one device by, from
    // the other end.
    const inside = await this.spaces.find({ roomId: { $in: held } }, { id: 1 }).lean();
    const spaceIds = [...new Set([...held, ...inside.map(space => space.id)])];

    return { $or: [{ ownerId: ctx.userId }, { spaceId: { $in: spaceIds } }] };
  }

  /** Only what a client may write. What the device is, who owns it and everything under `state` are not patched. */
  public async update(id: string, body: DeviceUpdate): Promise<StoredDevice> {
    const changes = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
    const changed = await this.devices.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<StoredDevice>();
    if (!changed) throw notFound('device_not_found', 'There is no device with that id.');

    // A camera the controller answers for stands wherever the controller does.
    if (body.spaceId !== undefined) await this.cameras.updateMany({ deviceId: id, removedAt: null }, { $set: { spaceId: changed.spaceId } });
    if (body.spaceId) await this.stoodIn(id, body.spaceId);

    return changed;
  }

  /**
   * The space may already be in a stage, and the device then takes what that
   * stage watches for. Nothing about it may refuse the move: the device stands
   * where it was put, and the thresholds are the next phase's to put right.
   */
  private async stoodIn(deviceId: string, spaceId: string): Promise<void> {
    try {
      await this.placement?.restateThresholds(deviceId, spaceId);
    } catch (error) {
      logger.error(`Could not restate the stage thresholds of device ${deviceId}: ${error}`);
    }
  }

  /**
   * The code the display shows is the whole proof, and it names the device, so
   * nothing else identifies one. A device that belongs to no space has no card
   * to appear on, so a claim always ends in one: naming a space puts it there,
   * and naming none makes one.
   */
  public async claim(ctx: AccessContext, body: DeviceClaimCreate): Promise<DeviceClaimResult> {
    const ownerId = ctx.userId;
    if (!ownerId || ctx.isDemo) throw conflict('no_account', 'A device belongs to somebody, and this session is nobody.');

    const claimCode = await this.claimCodes.findOne({ code: body.code.trim().toUpperCase() }).lean<StoredClaimCode>();
    if (!claimCode) throw notFound('claim_code_unknown', 'No device is showing that code. Read it off the display again.');

    const device = await this.require(claimCode.deviceId);
    if (device.ownerId !== null) throw conflict('device_claimed', 'That device already belongs to somebody.');

    const name = body.name ?? device.name ?? device.type;
    // Putting a device into a space that exists is managing that space.
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');

    // The device is taken first, and taken atomically: two people reading one
    // display cannot both end up owning it, and nothing is created for a claim
    // that lost the race.
    const claimed = await this.devices
      .findOneAndUpdate({ id: device.id, ownerId: null }, { $set: { ownerId, name, 'state.claimedAt': new Date() } }, { new: true })
      .lean<StoredDevice>();
    if (!claimed) throw conflict('device_claimed', 'That device already belongs to somebody.');

    // The code is spent; the display shows a fresh one when the device is asked.
    await this.claimCodes.deleteOne({ id: claimCode.id });

    // A device that belongs to no space has no card to appear on, so a claim
    // always ends in one: naming none makes one.
    const made = body.spaceId ? null : await this.spaces.create(this.spaceFor(ownerId, claimed, name));
    const spaceId = body.spaceId ?? made?.id ?? null;

    await this.devices.updateOne({ id: device.id }, { $set: { spaceId } });
    // A report that arrived between the two writes above made the camera row
    // before the device had anywhere to stand, so the place is put right here.
    // The row is this owner's already - a camera is made for the owner of the
    // device that reports it, and a device nobody owns gets no camera at all -
    // and a live row belonging to somebody else is not a claim's to take, with
    // every picture ever taken under it.
    await this.cameras.updateMany({ deviceId: device.id, ownerId, removedAt: null }, { $set: { spaceId } });
    // A space made for the claim has nothing standing in it yet; one that was
    // named may be a tent in the middle of a grow.
    if (body.spaceId) await this.stoodIn(device.id, body.spaceId);

    return { device: this.serialise({ ...claimed, spaceId }, ctx.isDemo), spaceCreated: made !== null };
  }

  /**
   * Giving a device up. It is not a deletion: the hardware is still out there
   * and claimable, and the readings it took stay where they are. What goes is
   * what the previous owner decided about it - their plan, their alarm rules,
   * the camera their controller answered for - because the next person to claim
   * it must not inherit any of it.
   */
  public async releaseClaim(id: string): Promise<void> {
    const released = await this.devices
      .findOneAndUpdate({ id }, { $set: { ownerId: null, spaceId: null, name: null, isDemo: false, 'state.claimedAt': null } })
      .lean<StoredDevice>();
    if (!released) throw notFound('device_not_found', 'There is no device with that id.');

    // The camera rows stay behind for the pictures taken under them, and stop
    // being a way to the camera itself: the credential and the addresses it is
    // answered at go with the claim, so hardware that is somebody else's now
    // cannot be read from the account that used to hold it. The pairing id
    // stays, because it opens nothing on its own and it is what gives this same
    // person their camera back if they ever claim the device again.
    await this.cameras.updateMany(
      { deviceId: id, removedAt: null },
      { $set: { removedAt: new Date(), deviceId: null, uid: null, ip: null, secret: null } },
    );
    await this.plans.deleteOne({ deviceId: id });
    await this.alarmRules.deleteMany({ deviceId: id });
  }

  /**
   * A device row made by hand, for hardware that has not been flashed yet or
   * that has to be put back after it was removed. It is unclaimed until somebody
   * claims it, like every other device, and it has no broker credentials until
   * it registers with them itself.
   */
  public async createAsAdmin(body: AdminDeviceCreate): Promise<StoredDevice> {
    if (await this.devices.exists({ id: body.id })) {
      throw conflict('device_exists', 'A device with that id is already registered.');
    }

    const device = await this.devices.create({ ...body, mqtt: null });
    return device.toObject<StoredDevice>();
  }

  /** The space a claim makes when it is given none: a place of its own, named after the device that stands in it. */
  private spaceFor(ownerId: string, device: StoredDevice, name: string): SpaceDocument {
    return {
      id: uuidv4(),
      ownerId,
      kind: SPACE_KIND[device.type] ?? 'other',
      name,
      roomId: null,
      presetPrompt: 'ask',
      retention: { climateDays: null },
      isDemo: device.isDemo,
      archivedAt: null,
      createdAt: new Date(),
    };
  }

  /** Field by field, because `_id` and the broker credentials ride on a stored document and never leave the server. */
  public serialise(device: StoredDevice, redacted = false): Device {
    const served: Device = {
      id: device.id,
      createdAt: device.createdAt.toISOString(),
      type: device.type,
      classId: device.classId,
      serialNumber: device.serialNumber,
      ownerId: device.ownerId,
      spaceId: device.spaceId,
      name: device.name,
      firmware: { channel: device.firmware.channel, targetId: device.firmware.targetId },
      configuration: device.configuration,
      settings: {
        vpdLeafOffsetDay: device.settings.vpdLeafOffsetDay,
        vpdLeafOffsetNight: device.settings.vpdLeafOffsetNight,
        ppfdLuxFactor: device.settings.ppfdLuxFactor,
      },
      isDemo: device.isDemo,
      state: {
        lastSeenAt: device.state.lastSeenAt?.toISOString() ?? null,
        claimedAt: device.state.claimedAt?.toISOString() ?? null,
        firmwareId: device.state.firmwareId,
        updateStartedAt: device.state.updateStartedAt?.toISOString() ?? null,
        updateEndedAt: device.state.updateEndedAt?.toISOString() ?? null,
        maintenanceUntil: device.state.maintenanceUntil?.toISOString() ?? null,
        hardware: device.state.hardware,
        socketStateChangedAt: Object.fromEntries(Object.entries(device.state.socketStateChangedAt).map(([slot, at]) => [slot, at.toISOString()])),
        socketsReportedAt: device.state.socketsReportedAt?.toISOString() ?? null,
      },
    };

    return redacted ? demoDevice(served) : served;
  }
}
