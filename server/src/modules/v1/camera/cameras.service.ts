import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Camera, CameraCreate, CameraUpdate } from '@fg2/shared-types/v1';
import { withoutCredentials } from '@common/log-path';
import { demoCamera } from '@utils/demo';
import { AccessContext, AccessRange, Grantee } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
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
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
  ) {}

  /**
   * The zone of the account that owns the camera, which is the calendar its
   * rolling films are cut on (see `film-periods.ts`); null where the owner is
   * gone, which leaves them on UTC.
   */
  public async zoneOf(camera: Pick<CameraDocument, 'ownerId'>): Promise<string | null> {
    const owner = await this.users.findOne({ id: camera.ownerId }, { 'preferences.timezone': 1 }).lean<Pick<StoredUser, 'preferences'>>();
    return owner?.preferences?.timezone || null;
  }

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
      rows.map(camera => this.serialise(camera, this.granteeOf(ctx, camera))),
      limit,
      camera => ({ at: new Date(camera.createdAt), id: camera.id }),
    );
  }

  /**
   * Which of the six a caller is, for a camera they have already been allowed to
   * read. It is not a decision about whether they may - `access()` and the
   * filter below have made that - but about how much of the row is theirs to
   * see, the same thing `Grant.grantee` carries on every route that reads one
   * camera. A list cannot ask for a grant per row without a query per row, and
   * it only ever answers a session, so the three standings a session can hold
   * here are worked out from the row itself.
   */
  public granteeOf(ctx: AccessContext, camera: Pick<CameraDocument, 'ownerId'>): Grantee {
    if (ctx.isAdmin) return 'admin';
    if (ctx.isDemo) return 'demo';

    return ctx.userId !== null && ctx.userId === camera.ownerId ? 'owner' : 'member';
  }

  /**
   * The cameras a caller may see at all, as one filter rather than a decision per
   * row: their own, and those standing in a space they are a member of. A demo
   * session sees the demo ones.
   *
   * An administrator is not widened here either, because this list is what the
   * Premium screen counts and offers to bill: an install-wide answer would sell
   * an operator somebody else's cameras. One camera asked for by id still goes
   * through `access()`, where the office is exactly the point.
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<CameraDocument>> {
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
   * What the camera *is* is answered to everybody who may read it; where it is
   * reached, what it is paired by and why it last failed are the owner's alone.
   *
   * A demo session is shown somebody's real tent and a member is shown the
   * host's, and neither of them is looking at their own hardware: `did` is the
   * identity a Terp Cam is paired by, `ip` and `url` say where it sits on a home
   * network - which these cameras answer on with a default login that is no
   * secret - and `lastError` carries the paths and the tunnel address the
   * server reached it over. None of it is part of seeing the tent, and the
   * invitation promises the guest the tent and the cams, not the house they
   * stand in.
   *
   * `seen` is the window the reader holds, where they hold one. A window that
   * has closed is a tent as it stood and not a tent now, so when the camera last
   * fired and what firmware it is running are dated after the reader's window
   * and are none of their business - which is what the tent page next door
   * already answers for the same camera through the same kind of link.
   */
  public serialise(camera: CameraDocument, to: Grantee = 'owner', now: Date = new Date(), seen: AccessRange = OPEN_ENDED): Camera {
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
      state: stillOpen(seen, now)
        ? {
            lastStillAt: camera.state.lastStillAt?.toISOString() ?? null,
            lastError: camera.state.lastError,
            firmwareVersion: camera.state.firmwareVersion,
          }
        : { lastStillAt: null, lastError: null, firmwareVersion: null },
    };

    if (to === 'demo') return demoCamera(served);

    if (to === 'owner' || to === 'admin') return served;

    return to === 'member' ? withoutTheOwnersAddress(served) : withoutTheOwner(served);
  }
}

/** What an owner, a member and an admin read their own hardware through: no window at all. */
const OPEN_ENDED: AccessRange = { startsAt: null, endsAt: null };

/** Whether the reader's window still reaches the present, which is the only thing that makes a "now" theirs to be told. */
const stillOpen = (seen: AccessRange, now: Date): boolean => seen.endsAt === null || seen.endsAt >= now;

/**
 * A camera as somebody who does not own it is answered: still a camera, with a
 * name, a place, a kind and a state, and with nothing in it that says where the
 * owner lives or how their hardware is reached. It is what the demo redaction
 * has always done, applied to the other people a round of sharing let in.
 */
const withoutTheOwnersAddress = (camera: Camera): Camera => ({
  ...camera,
  did: null,
  uid: null,
  ip: null,
  url: null,
  state: { ...camera.state, lastError: null },
});

/**
 * A camera as a link or a public page answers it: nor whose account it is, the
 * controller it hangs off, or what the owner paid for and until when - the
 * diary and the pictures a stranger reads leave out the author and the device
 * for the same reason. The tier stays, because it is what the pictures they
 * are shown are narrowed to.
 */
const withoutTheOwner = (camera: Camera): Camera => ({
  ...withoutTheOwnersAddress(camera),
  ownerId: null,
  deviceId: null,
  entitlement: { ...camera.entitlement, validUntil: null, grant: null, renewalVisible: false },
});

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
