import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { socketChunkCount, socketListChunk } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { logger } from '@utils/logger';
import { decodeSockets } from './sockets';

/**
 * The `hardware-info:` sub-protocol: what a device has found in itself.
 *
 * It rides the log topic as `hardware-info:<key>=<value>`, is never a diary
 * line, and is answered with nothing. The report is kept flat, exactly as the
 * device sends it, in `devices.state.hardware` - its keys belong to the firmware
 * of that type, so nothing here constrains them - and three of them mean
 * something beyond being stored: the socket table, the camera, and the build the
 * device is running.
 *
 * The `none` sentinel is the reason the report can be trusted at all. A device
 * says `webcam_did=none` and `sockets=none` rather than staying silent, because
 * silence cannot clear a stale value; a key that is absent altogether means
 * "firmware too old to report", which is a different fact and the only reliable
 * feature test in the protocol.
 */

/** The key becomes part of an update path, so it may not escape the subtree or bloat the document. */
const KEY = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_VALUE_LENGTH = 512;

/** What the report spells "there is none" as. */
const NONE = 'none';

/** A Terp Cam's P2P device id, which goes on to be part of a URL. */
const CAMERA_ID = /^[A-Za-z0-9_-]{4,32}$/;

/** A camera's year of Premium, from the day it is first paired. Nothing renews on its own. */
const ENTITLEMENT_MONTHS = 12;

/**
 * Two reported values never reach `devices.state.hardware`: the camera's
 * password and its stored stream URL, which carries credentials in it. They
 * belong to the camera, which keeps its secret where nothing serialises it -
 * a copy in the hardware report would be handed out with the sockets.
 */
const CAMERA_SECRET_KEYS = ['webcam_pwd', 'webcam_url'];

export interface HardwareInfo {
  key: string;
  value: string;
}

@Injectable()
export class HardwareReportService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
  ) {}

  /**
   * One reported key. Anything malformed is dropped without a word, as it always
   * has been: the report rides a queue a device drops entries from, so a caller
   * cannot be told about it either way.
   */
  public async report(device: StoredDevice, payload: string): Promise<HardwareInfo | null> {
    // Only the first `=` separates the key from the value; a value may contain more.
    const separator = payload.indexOf('=');
    if (separator <= 0) return null;

    const key = payload.slice(0, separator).trim();
    const value = payload.slice(separator + 1);
    if (!KEY.test(key) || value.length > MAX_VALUE_LENGTH) return null;

    if (CAMERA_SECRET_KEYS.includes(key)) {
      await this.rememberCameraSecret(device, key, value);
      return { key, value };
    }

    const hardware = { ...device.state.hardware, [key]: value };
    await this.devices.updateOne({ id: device.id }, { $set: { [`state.hardware.${key}`]: value } });

    if (key === 'sockets_n') await this.dropSupersededChunks(device.id, hardware, Number(value));
    if (key === 'sockets_n' || socketListChunk(key) !== null) await this.stampSocketStates(device.id, device.state.hardware, hardware);
    if (key === 'webcam_did') await this.reconcileCamera({ ...device, state: { ...device.state, hardware } }, value);
    if (key === 'webcam_ip' || key === 'webcam_uid') await this.updateCamera(device.id, { [key === 'webcam_ip' ? 'ip' : 'uid']: notNone(value) });

    return { key, value };
  }

  /**
   * The camera a controller pairs is paired on the device, in its menu, so the
   * device is where the pairing lives and the cloud follows: without this the
   * camera is paired and invisible.
   *
   * It is a camera of its own rather than a field on the device, and the row
   * survives being unpaired as a tombstone - so the pictures it took keep their
   * link, and pairing the same camera again gives it back the entitlement it
   * already had rather than a new year.
   */
  public async reconcileCamera(device: StoredDevice, did: string): Promise<void> {
    const paired = notNone(did);

    if (paired === null) {
      await this.cameras.updateOne({ deviceId: device.id, kind: 'terpcam_controller', removedAt: null }, { $set: { removedAt: new Date() } });
      return;
    }

    // The id goes into a URL, so only the shape a real one has is adopted.
    if (!CAMERA_ID.test(paired)) return;

    // A camera belongs to somebody. An unclaimed device keeps reporting its
    // camera, and the row is made the next time it does once the device has an
    // owner - or by the claim itself, which reconciles what the device reported.
    if (!device.ownerId) return;

    const existing = await this.cameras
      .findOne({ kind: 'terpcam_controller', $or: [{ deviceId: device.id }, { did: paired }] })
      // A live row before a tombstone (a null sorts first), and the newest of each.
      .sort({ removedAt: 1, createdAt: -1 })
      .lean();

    if (existing) {
      await this.cameras.updateOne({ id: existing.id }, { $set: { deviceId: device.id, did: paired, removedAt: null } });
      return;
    }

    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + ENTITLEMENT_MONTHS);

    await this.cameras.create({
      id: uuidv4(),
      ownerId: device.ownerId,
      kind: 'terpcam_controller',
      deviceId: device.id,
      spaceId: device.spaceId,
      name: device.name ?? device.id,
      did: paired,
      uid: notNone(device.state.hardware.webcam_uid),
      ip: notNone(device.state.hardware.webcam_ip),
      model: 'terp_cam',
      entitlement: { validUntil, grant: 'included' },
      isDemo: device.isDemo,
    });

    logger.info(`Device ${device.id} reported a paired camera`);
  }

  /** Reported on every attempt to secure the camera, including the failed ones, where it is empty. */
  private async rememberCameraSecret(device: StoredDevice, key: string, value: string): Promise<void> {
    if (key !== 'webcam_pwd') return;

    await this.updateCamera(device.id, { secret: value.length > 0 ? value : null });
  }

  private async updateCamera(deviceId: string, fields: Partial<CameraDocument>): Promise<void> {
    await this.cameras.updateOne({ deviceId, kind: 'terpcam_controller', removedAt: null }, { $set: fields });
  }

  /**
   * A table that has shrunk leaves the chunks of the larger one behind. A reader
   * bound by `sockets_n` ignores them, but a stored report that contradicts
   * itself is a trap for whoever reads the device next. The count always arrives
   * before the chunks, so this never removes one that is about to be written.
   */
  private async dropSupersededChunks(deviceId: string, hardware: Record<string, string>, count: number): Promise<void> {
    if (!Number.isInteger(count) || count < 0) return;

    const stale = Object.keys(hardware).filter(key => (socketListChunk(key) ?? -1) >= socketChunkCount(count));
    if (stale.length === 0) return;

    await this.devices.updateOne({ id: deviceId }, { $unset: Object.fromEntries(stale.map(key => [`state.hardware.${key}`, ''])) });
  }

  /**
   * When a socket row was last seen to change state. The row says that it is on
   * or off and never since when, so the instant is stamped here - and only where
   * both the old and the new report say which it was, so a build that starts
   * reporting the state column does not read as every socket having just moved.
   */
  private async stampSocketStates(deviceId: string, before: Record<string, string>, after: Record<string, string>): Promise<void> {
    const previous = new Map(decodeSockets(before).map(socket => [socket.slot, socket.state]));
    const now = new Date();

    const changed = decodeSockets(after).filter(socket => {
      const was = previous.get(socket.slot);
      return was !== undefined && was !== 'unknown' && socket.state !== 'unknown' && was !== socket.state;
    });

    if (changed.length === 0) return;

    await this.devices.updateOne(
      { id: deviceId },
      { $set: Object.fromEntries(changed.map(socket => [`state.socketStateChangedAt.${socket.slot}`, now])) },
    );
  }
}

const notNone = (value: string | undefined): string | null => {
  const text = (value ?? '').trim();
  return text.length === 0 || text === NONE ? null : text;
};
