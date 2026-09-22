import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Camera, CameraCreate, CameraUpdate } from '@fg2/shared-types/v1';
import { withoutCredentials } from '@common/log-path';
import { demoCamera } from '@utils/demo';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { EntitlementService, yearFrom } from './entitlement.service';

/**
 * The `cameras` collection: what is stored about a camera, and what of it is
 * answered.
 *
 * A camera is its own record rather than a field on a device, so a tent holds
 * several - the Terp Cam its controller pairs, RTSP cameras pulled through that
 * controller's tunnel, and standalone Terp Cams the cloud reaches itself. A
 * camera that is taken away stays behind as a tombstone (`removedAt`), because
 * every picture it ever delivered still points at it.
 */

/** What a list of cameras may be narrowed by. */
export interface CameraFilter {
  spaceId?: string;
  deviceId?: string;
  /** Tombstones are left out unless somebody is looking for a camera that is gone. */
  includeRemoved?: boolean;
}

/** A camera with the P2P credential the capture path needs and nothing else may read. */
export type CameraWithSecret = CameraDocument & { secret: string | null };

@Injectable()
export class CamerasService {
  constructor(
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    private readonly entitlement: EntitlementService,
  ) {}

  public byId(id: string): Promise<CameraDocument | null> {
    return this.cameras.findOne({ id }).lean<CameraDocument>();
  }

  /**
   * Whether a stream may be pulled through this device. The tunnel is a
   * controller's alone: every other type stands in a tent without offering the
   * network a way in, so a fridge module named as the carrier of a stream is a
   * promise nothing could keep.
   */
  public async carriesATunnel(deviceId: string): Promise<boolean> {
    const device = await this.devices.findOne({ id: deviceId }, { type: 1 }).lean();
    return device?.type === 'controller';
  }

  /** The one Terp Cam this controller has paired, which `POST /cameras` adopts rather than doubling. */
  public controllerCameraOf(deviceId: string | null | undefined): Promise<CameraDocument | null> {
    if (!deviceId) return Promise.resolve(null);
    return this.cameras.findOne({ deviceId, kind: 'terpcam_controller', removedAt: null }).lean<CameraDocument>();
  }

  /** Only the two paths that open a stream ask for this; every other read leaves the secret behind. */
  public withSecret(id: string): Promise<CameraWithSecret | null> {
    return this.cameras.findOne({ id }).select('+secret').lean<CameraWithSecret>();
  }

  /** Every camera the pipeline reads from: live ones, whatever kind. */
  public capturable(): Promise<CameraDocument[]> {
    return this.cameras.find({ removedAt: null }).sort({ id: 1 }).lean<CameraDocument[]>();
  }

  /** Tombstones included: their pictures are still thinned, swept and served. */
  public all(): Promise<CameraDocument[]> {
    return this.cameras.find({}).sort({ id: 1 }).lean<CameraDocument[]>();
  }

  public async list(ctx: AccessContext, filter: CameraFilter, page: PageQuery): Promise<CursorPage<Camera>> {
    const limit = pageLimit(page.limit);
    // Combined rather than merged into one object: the visibility and the cursor
    // are each an `$or` of their own, and one would silently replace the other -
    // which would hand out everything that sorts after the cursor from the
    // second page on, while the first page looked right.
    const conditions: FilterQuery<CameraDocument>[] = [await this.visibleTo(ctx), narrowing(filter), afterCursor('createdAt', page.cursor)];

    const rows = await this.cameras.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<CameraDocument[]>();

    return pageOf(
      rows.map(camera => this.serialise(camera, ctx.isDemo)),
      limit,
      camera => ({ at: new Date(camera.createdAt), id: camera.id }),
    );
  }

  /**
   * The cameras a caller may see at all, as one filter rather than a decision per
   * row: their own, and those standing in a space they are a member of. An admin
   * sees every camera, a demo session the demo ones.
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<CameraDocument>> {
    if (ctx.isAdmin) return {};
    if (ctx.isDemo || ctx.userId === null) return { isDemo: true };

    const rows = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean();
    const spaceIds = rows.map(row => row.spaceId);

    return spaceIds.length > 0 ? { $or: [{ ownerId: ctx.userId }, { spaceId: { $in: spaceIds } }] } : { ownerId: ctx.userId };
  }

  /**
   * A camera as it is stored. The controller has already decided the caller may
   * make one here; what this owns is the shape.
   *
   * A Terp Cam starts its twelve months when it is first claimed or paired. An
   * RTSP camera has no included year of its own and is entitled by purchase
   * alone, which is what the Premium screen says about a camera that is not a
   * Terp Cam. Creating one is never refused - whether the address answers is
   * found out by the first capture.
   */
  public async create(ownerId: string, body: CameraCreate): Promise<CameraDocument> {
    const isTerpCam = body.kind !== 'rtsp';
    const createdAt = new Date();
    const deviceId = body.kind === 'terpcam_standalone' ? null : (body.deviceId ?? null);
    const device = deviceId ? await this.devices.findOne({ id: deviceId }, { spaceId: 1, isDemo: 1 }).lean() : null;

    const camera: CameraDocument = {
      id: uuidv4(),
      createdAt,
      ownerId,
      kind: body.kind,
      deviceId,
      // A camera that names no space stands where its controller stands.
      spaceId: body.spaceId ?? device?.spaceId ?? null,
      name: body.name,
      looksAt: body.looksAt ?? null,
      plantIds: body.plantIds ?? [],
      did: body.kind === 'terpcam_standalone' ? body.did : null,
      uid: null,
      ip: null,
      secret: null,
      url: body.kind === 'rtsp' ? body.url : null,
      transport: body.kind === 'rtsp' ? (body.transport ?? null) : null,
      tunnel: body.kind === 'rtsp' ? (body.tunnel ?? false) : false,
      model: body.kind === 'rtsp' ? (body.model ?? null) : 'terp_cam',
      stillIntervalSeconds: body.stillIntervalSeconds ?? DEFAULT_STILL_INTERVAL_SECONDS,
      nightOff: body.nightOff ?? false,
      maintenanceOff: body.maintenanceOff ?? false,
      logErrors: body.logErrors ?? false,
      staleWarning: body.staleWarning ?? true,
      entitlement: isTerpCam ? { validUntil: yearFrom(createdAt), grant: 'included' } : { validUntil: null, grant: null },
      isDemo: device?.isDemo ?? false,
      removedAt: null,
      state: { lastStillAt: null, lastError: null, firmwareVersion: null },
    };

    await this.cameras.create(camera);
    return camera;
  }

  /** Only what a client may write; what a camera *is* - its kind and its id - is not patched. */
  public async update(id: string, body: CameraUpdate): Promise<CameraDocument | null> {
    const changes = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
    return this.cameras.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<CameraDocument>();
  }

  /** Written by the admin route alone: nothing in this server renews an entitlement on its own. */
  public setEntitlement(id: string, entitlement: CameraDocument['entitlement']): Promise<CameraDocument | null> {
    return this.cameras.findOneAndUpdate({ id }, { $set: { entitlement } }, { new: true }).lean<CameraDocument>();
  }

  /**
   * Taking a camera away is not deleting it: the stills and the films it
   * delivered keep their link, so the row stays as a tombstone and is no longer
   * listed, polled or paired to its controller.
   */
  public async remove(id: string): Promise<void> {
    await this.cameras.updateOne({ id, removedAt: null }, { $set: { removedAt: new Date(), deviceId: null } });
  }

  /** What the poller reports back after every try, and what the health loop reads. */
  public async noteCapture(id: string, at: Date | null, error: string | null): Promise<void> {
    await this.cameras.updateOne({ id }, { $set: { ...(at ? { 'state.lastStillAt': at } : {}), 'state.lastError': error } });
  }

  /**
   * `redacted` is for a demo session, which is shown somebody's real tent: what
   * the camera *is* stays, and the address it is reached at, the id it is paired
   * by and the reason it last failed go.
   */
  public serialise(camera: CameraDocument, redacted = false, now: Date = new Date()): Camera {
    const served: Camera = {
      id: camera.id,
      createdAt: camera.createdAt.toISOString(),
      ownerId: camera.ownerId,
      kind: camera.kind,
      deviceId: camera.deviceId,
      spaceId: camera.spaceId,
      name: camera.name,
      looksAt: camera.looksAt,
      plantIds: camera.plantIds,
      did: camera.did,
      uid: camera.uid,
      ip: camera.ip,
      url: withoutUserInfo(camera.url),
      transport: camera.transport,
      tunnel: camera.tunnel,
      model: camera.model,
      stillIntervalSeconds: camera.stillIntervalSeconds,
      nightOff: camera.nightOff,
      maintenanceOff: camera.maintenanceOff,
      logErrors: camera.logErrors,
      // Read as an opt-out rather than as a truth: a row carried over by the
      // migration has no value for this field until the health loop fills it
      // in, and it is warned about meanwhile.
      staleWarning: camera.staleWarning !== false,
      entitlement: this.entitlement.serialise(camera, now),
      isDemo: camera.isDemo,
      removedAt: camera.removedAt?.toISOString() ?? null,
      state: {
        lastStillAt: camera.state.lastStillAt?.toISOString() ?? null,
        lastError: camera.state.lastError,
        firmwareVersion: camera.state.firmwareVersion,
      },
    };

    return redacted ? demoCamera(served) : served;
  }
}

/** How often the pipeline has always asked a camera for a picture. */
export const DEFAULT_STILL_INTERVAL_SECONDS = 30;

const narrowing = (filter: CameraFilter): FilterQuery<CameraDocument> => ({
  ...(filter.spaceId ? { spaceId: filter.spaceId } : {}),
  ...(filter.deviceId ? { deviceId: filter.deviceId } : {}),
  ...(filter.includeRemoved ? {} : { removedAt: null }),
});

/**
 * The stream URL as it is answered: the credentials it is opened with are the
 * server's to keep, and the owner is no more entitled to read them back than
 * anybody else. A value that is not a URL at all is redacted by pattern, so a
 * malformed one cannot carry a password out.
 */
const withoutUserInfo = (url: string | null): string | null => {
  if (url === null) return null;

  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return withoutCredentials(url);
  }
};
