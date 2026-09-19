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
    if (key === 'sockets_n' || socketListChunk(key) !== null) await this.noteSocketReport(device, device.state.hardware, hardware);
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
   *
   * A camera belongs to whoever owns the device that reported it, and a device
   * changes hands, so the only rows a report ever reaches are that owner's. A
   * camera this account has had before comes back whole; anything else - the
   * camera the last owner had, a camera still working on another device - is a
   * camera this account has not seen, and what it gets is a row of its own with
   * a year of its own. Neither half of a revive would do: left as it was it
   * photographs one person's tent into another person's camera, and re-owned it
   * hands over every picture already taken under it. A new row does neither,
   * and the old one stays buried with the pictures that are its owner's.
   */
  public async reconcileCamera(device: StoredDevice, did: string): Promise<void> {
    const paired = notNone(did);

    if (paired === null) {
      await this.cameras.updateOne({ deviceId: device.id, kind: 'terpcam_controller', removedAt: null }, { $set: { removedAt: new Date() } });
      return;
    }

    // The id goes into a URL, so only the shape a real one has is adopted.
    if (!CAMERA_ID.test(paired)) return;

    // A camera belongs to somebody, and a device that is nobody's has nobody to
    // make one for. It keeps reporting its camera while it waits, and the row is
    // made the first time it reports after being claimed.
    if (!device.ownerId) return;

    // This owner's rows and no others: the one this controller already answers
    // for, whatever it has paired, and one this account itself buried for the
    // very camera being reported. A buried row is only claimed back while it is
    // buried - a row that is live is a camera working on the device it names,
    // and reporting the same pairing id elsewhere does not move it there.
    const existing = await this.cameras
      .findOne({ kind: 'terpcam_controller', ownerId: device.ownerId, $or: [{ deviceId: device.id }, { did: paired, removedAt: { $ne: null } }] })
      // A live row before a tombstone (a null sorts first), and the newest of each.
      .sort({ removedAt: 1, createdAt: -1 })
      .lean();

    if (existing) {
      // A camera coming back from the dead stands where its controller stands,
      // because nothing it said about where it stood outlived being taken away.
      // A live one is left where its owner put it, which is not always the
      // controller's own tent.
      const placed = existing.removedAt === null ? {} : { spaceId: device.spaceId };
      await this.cameras.updateOne({ id: existing.id }, { $set: { deviceId: device.id, did: paired, removedAt: null, ...placed } });
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
   * When the table arrived, and when a row was last seen to change state.
   *
   * The instant of the report is what an override's row is read against: it
   * carries the seconds the override had left and never a time of day, so
   * without the instant the same countdown would read as full every time
   * somebody looked. A row says that it is on or off and never since when, so
   * that instant is stamped too - and only where the previous report said which
   * it was, so a build that starts reporting the state column does not read as
   * every socket having just moved. A row that falls silent is such a change:
   * a socket that stopped answering is the one thing the table says about it,
   * and how long it has been quiet is the rest of that sentence.
   *
   * A stamp is keyed by slot, and a slot outlives the socket that sat in it:
   * one that now holds a different plug, or none, is forgotten rather than
   * answering "since" a moment that was another socket's.
   */
  private async noteSocketReport(device: StoredDevice, before: Record<string, string>, after: Record<string, string>): Promise<void> {
    const previous = new Map(decodeSockets(before).map(socket => [socket.slot, socket]));
    const sockets = decodeSockets(after);
    const now = new Date();

    const changed = sockets.filter(socket => {
      const was = previous.get(socket.slot);
      if (!was) return false;
      // A row whose hardware id has changed is another socket in the same slot.
      if (was.hardwareId !== '' && socket.hardwareId !== '' && was.hardwareId !== socket.hardwareId) return false;

      return was.state !== 'unknown' && was.state !== socket.state;
    });

    const held = new Set(sockets.map(socket => String(socket.slot)));
    const stale = Object.keys(device.state.socketStateChangedAt ?? {}).filter(slot => {
      const socket = sockets.find(row => String(row.slot) === slot);
      const was = previous.get(Number(slot));
      return !held.has(slot) || (was && socket && was.hardwareId !== '' && socket.hardwareId !== '' && was.hardwareId !== socket.hardwareId);
    });

    await this.devices.updateOne(
      { id: device.id },
      {
        $set: {
          'state.socketsReportedAt': now,
          ...Object.fromEntries(changed.map(socket => [`state.socketStateChangedAt.${socket.slot}`, now])),
        },
        ...(stale.length > 0 ? { $unset: Object.fromEntries(stale.map(slot => [`state.socketStateChangedAt.${slot}`, ''])) } : {}),
      },
    );
  }
}

const notNone = (value: string | undefined): string | null => {
  const text = (value ?? '').trim();
  return text.length === 0 || text === NONE ? null : text;
};
