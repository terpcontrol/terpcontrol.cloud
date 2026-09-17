import { mongo } from 'mongoose';
import { IMAGE_BUCKET_NAME } from '@database/image-store';
import { LEGACY, LegacyDeviceLog, LegacyImage, createdAtOf, instantOf, numberOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { loadDeviceFacts } from '../device-facts';
import { growAt, reconstructGrows } from '../grow-cycles';

/**
 * The pictures. **The bytes are not rewritten**: a media row keeps the
 * `image_id` it was made from as its own `id`, which is the file id in the
 * GridFS bucket, so every picture stays exactly where it is.
 *
 * What the old row does not say, decided here:
 *
 * - **What a picture belongs to.** A still and a timelapse belong to the camera
 *   of the device they came from - the camera migration makes one for every
 *   device that has pictures, retired where the stream is gone, so none of them
 *   is left pointing at nothing. A photo belongs to no camera: it takes the
 *   space of the device it was uploaded on, and its grow through the diary entry
 *   that carries it.
 * - **Who uploaded it.** The device's owner for a photo, because a device has
 *   had exactly one writer; nobody for what a camera delivered.
 * - **Its size** is what the store recorded, and where a row predates that field
 *   the bucket is asked for the file's length, or the payload still in the
 *   document is measured. A picture with no bytes anywhere is rejected: there is
 *   nothing left of it to serve.
 * - **A timelapse's quality and length** were never stored, so both stay null.
 *   `render` is null as well: these are films that were built, not jobs waiting
 *   for the composer.
 */

const KIND: Record<string, { kind: string; mime: string }> = {
  jpeg: { kind: 'still', mime: 'image/jpeg' },
  mp4: { kind: 'timelapse', mime: 'video/mp4' },
  'user/jpeg': { kind: 'photo', mime: 'image/jpeg' },
};

const WINDOW: Record<string, string> = { '1d': 'day', '1w': 'week', '1m': 'month' };

export const media: MigrationStep = {
  name: '012-media',

  async run(context: MigrationContext): Promise<void> {
    await context.renameAside(LEGACY.devices);
    await context.renameAside(LEGACY.deviceLogs);

    const facts = await loadDeviceFacts(context);
    const grows = await reconstructGrows(context, facts);
    const photoEntries = await entriesByPicture(context);

    await context.renameAside(LEGACY.images);
    const legacy = await context.source(LEGACY.images);
    const files = context.db.collection<{ _id: unknown; length?: number }>(`${IMAGE_BUCKET_NAME}.files`);

    for await (const image of legacy.find<LegacyImage>({}).sort({ _id: 1 })) {
      context.count('media.read');

      const id = textOf(image.image_id);
      const deviceId = textOf(image.device_id);
      const format = textOf(image.format);
      const shape = format ? KIND[format] : undefined;
      const capturedAt = instantOf(image.timestamp);

      if (!id || !shape || !capturedAt) {
        context.reject({
          source: LEGACY.images,
          id: id ?? String(image._id),
          reason: !shape ? 'the picture has a format nothing knows' : 'the picture has no id or no instant',
          dropped: true,
          detail: format,
        });
        continue;
      }

      const bytes =
        numberOf(image.size) ?? numberOf((await files.findOne({ _id: id as never }, { projection: { length: 1 } }))?.length) ?? inlineBytes(image);
      if (bytes === null) {
        context.reject({ source: LEGACY.images, id, reason: 'no bytes are stored for this picture', dropped: true, detail: deviceId });
        continue;
      }

      const fact = deviceId ? facts.get(deviceId) : undefined;
      const isPhoto = shape.kind === 'photo';
      const entry = isPhoto ? photoEntries.get(id) : undefined;
      const grow = entry?.deviceId && entry.at ? growAt(grows.get(entry.deviceId), entry.at) : null;

      if (!isPhoto && fact?.cameraId == null) context.count('media.withoutCamera');

      await context.write('media', {
        id,
        createdAt: createdAtOf(image),
        kind: shape.kind,
        mime: shape.mime,
        bytes,
        cameraId: isPhoto ? null : (fact?.cameraId ?? null),
        growId: grow?.id ?? null,
        spaceId: isPhoto ? (fact?.spaceId ?? null) : null,
        uploadedBy: isPhoto ? (fact?.ownerId ?? null) : null,
        capturedAt,
        endsAt: instantOf(image.timestampEnd),
        window: WINDOW[textOf(image.duration) ?? ''] ?? null,
        quality: null,
        lengthSeconds: null,
        render: null,
      });
    }
  },
};

/**
 * The length of a payload that is still in the picture's own document.
 *
 * By the time this migration runs, the first one has moved those bytes into the
 * bucket and recorded their length - but a dry run writes nothing at all, so
 * without this the rehearsal reports every such picture as one with no bytes
 * anywhere, which is a reject an operator cannot act on and which the real run
 * does not produce.
 */
const inlineBytes = (image: LegacyImage): number | null => {
  if (Buffer.isBuffer(image.data)) return image.data.length;
  return image.data instanceof mongo.Binary ? image.data.length() : null;
};

/** Which diary entry carries which picture, so a photo can reach the grow it was logged in. */
const entriesByPicture = async (context: MigrationContext): Promise<Map<string, { deviceId: string | null; at: Date | null }>> => {
  const logs = await context.source(LEGACY.deviceLogs);
  const byPicture = new Map<string, { deviceId: string | null; at: Date | null }>();

  const cursor = logs.find<LegacyDeviceLog>({ 'images.0': { $exists: true } }, { projection: { device_id: 1, time: 1, images: 1 } });
  for await (const log of cursor) {
    for (const pictureId of log.images ?? []) {
      byPicture.set(pictureId, { deviceId: textOf(log.device_id), at: log.time instanceof Date ? log.time : null });
    }
  }

  return byPicture;
};
