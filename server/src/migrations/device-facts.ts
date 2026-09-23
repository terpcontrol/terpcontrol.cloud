import { cameraIdOf, spaceIdOf } from './ids';
import { LEGACY, LegacyDevice, flagOf, instantOf, terpCamLabelOf, textOf } from './legacy';
import { MigrationContext } from './migration';

/**
 * What every transform that is not about devices still has to know about one.
 *
 * Six of the thirteen migrations read the device collection for the same four
 * answers - who owns it, which space it became, which camera it became, whether
 * it is part of the demo - and the answers have to be identical in all of them,
 * because they are what the copies point at. Deriving them in one place is what
 * keeps a grow, an entry and a picture attached to the same space.
 */
export interface DeviceFacts {
  id: string;
  type: string;
  name: string | null;
  ownerId: string | null;
  /** The space the device became; null when it was never claimed, and a device without an owner has no space. */
  spaceId: string | null;
  /** The camera it became; null when it has neither a stream nor a picture, or nobody to own one. */
  cameraId: string | null;
  isDemo: boolean;
  /** What `cloudSettings.rtspStream` holds, if anything. */
  stream: string | null;
  /** The Terp Cam id in that stream, if it is one. */
  terpCamLabel: string | null;
  /** The camera is a tombstone: pictures point at it, but the device has no stream any more. */
  cameraRetired: boolean;
  /** When the device's camera last delivered a still; null when it never delivered one. */
  lastStillAt: Date | null;
}

/** Picture formats that came from a camera. A `user/jpeg` is a photo somebody uploaded and belongs to no camera. */
const CAMERA_FORMATS = ['jpeg', 'mp4'];

/** The format a still was stored under. The `mp4` of the same set is a timelapse, which is built rather than captured. */
const STILL_FORMAT = 'jpeg';

export const loadDeviceFacts = async (context: MigrationContext): Promise<Map<string, DeviceFacts>> => {
  const devices = await context.source(LEGACY.devices);
  const pictures = await picturesByDevice(context);
  const facts = new Map<string, DeviceFacts>();

  for await (const device of devices.find<LegacyDevice>({})) {
    const id = textOf(device.device_id);
    if (!id) continue;

    const ownerId = textOf(device.owner_id);
    const stream = textOf(device.cloudSettings?.rtspStream);
    // A camera needs somebody to own it, so an unclaimed device never gets one -
    // and neither its stream nor its pictures were reachable by anybody today.
    const hasCamera = ownerId !== null && (stream !== null || pictures.has(id));

    facts.set(id, {
      id,
      type: textOf(device.device_type) ?? 'controller',
      name: textOf(device.name),
      ownerId,
      spaceId: ownerId ? spaceIdOf(id) : null,
      cameraId: hasCamera ? cameraIdOf(id) : null,
      isDemo: flagOf(device.demoDevice),
      stream,
      terpCamLabel: terpCamLabelOf(stream),
      cameraRetired: hasCamera && stream === null,
      lastStillAt: hasCamera ? (pictures.get(id)?.lastStillAt ?? null) : null,
    });
  }

  return facts;
};

/**
 * What every device's pictures say about it, in one pass over the collection.
 *
 * Which devices have any decides who gets a retired camera: a device that has
 * stills but no stream any more still has to have something for those pictures
 * to belong to, or they lose their link. The newest of them is the instant that
 * camera last delivered, which is the only record left of it - the old database
 * kept no such field on the device, so the pictures themselves are the answer.
 *
 * Only a still counts as a delivery. A timelapse shares the group because it is
 * equally a camera's output and equally decides that a camera has to exist, but
 * it was assembled out of stills that are already counted, so letting one set
 * the instant would date a camera by the film rather than by the last picture it
 * took.
 */
const picturesByDevice = async (context: MigrationContext): Promise<Map<string, { lastStillAt: Date | null }>> => {
  const images = await context.source(LEGACY.images);
  const grouped = await images
    .aggregate<{ _id: string; newestStill: number | null }>([
      { $match: { format: { $in: CAMERA_FORMATS } } },
      { $group: { _id: '$device_id', newestStill: { $max: { $cond: [{ $eq: ['$format', STILL_FORMAT] }, '$timestamp', null] } } } },
    ])
    .toArray();

  return new Map(
    grouped
      .filter(entry => typeof entry._id === 'string' && entry._id.length > 0)
      .map(entry => [entry._id, { lastStillAt: instantOf(entry.newestStill) }]),
  );
};
