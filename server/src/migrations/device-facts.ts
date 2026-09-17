import { cameraIdOf, spaceIdOf } from './ids';
import { LEGACY, LegacyDevice, terpCamLabelOf, textOf } from './legacy';
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
}

/** Picture formats that came from a camera. A `user/jpeg` is a photo somebody uploaded and belongs to no camera. */
const CAMERA_FORMATS = ['jpeg', 'mp4'];

export const loadDeviceFacts = async (context: MigrationContext): Promise<Map<string, DeviceFacts>> => {
  const devices = await context.source(LEGACY.devices);
  const withPictures = await devicesWithPictures(context);
  const facts = new Map<string, DeviceFacts>();

  for await (const device of devices.find<LegacyDevice>({})) {
    const id = textOf(device.device_id);
    if (!id) continue;

    const ownerId = textOf(device.owner_id);
    const stream = textOf(device.cloudSettings?.rtspStream);
    // A camera needs somebody to own it, so an unclaimed device never gets one -
    // and neither its stream nor its pictures were reachable by anybody today.
    const hasCamera = ownerId !== null && (stream !== null || withPictures.has(id));

    facts.set(id, {
      id,
      type: textOf(device.device_type) ?? 'controller',
      name: textOf(device.name),
      ownerId,
      spaceId: ownerId ? spaceIdOf(id) : null,
      cameraId: hasCamera ? cameraIdOf(id) : null,
      isDemo: device.demoDevice === true,
      stream,
      terpCamLabel: terpCamLabelOf(stream),
      cameraRetired: hasCamera && stream === null,
    });
  }

  return facts;
};

/**
 * The devices whose pictures came from a camera. They decide which devices get a
 * retired camera: a device that has stills but no stream any more still has to
 * have something for those pictures to belong to, or they lose their link.
 */
const devicesWithPictures = async (context: MigrationContext): Promise<Set<string>> => {
  const images = await context.source(LEGACY.images);
  const grouped = await images
    .aggregate<{ _id: string }>([{ $match: { format: { $in: CAMERA_FORMATS } } }, { $group: { _id: '$device_id' } }])
    .toArray();
  return new Set(grouped.map(entry => entry._id).filter((id): id is string => typeof id === 'string' && id.length > 0));
};
