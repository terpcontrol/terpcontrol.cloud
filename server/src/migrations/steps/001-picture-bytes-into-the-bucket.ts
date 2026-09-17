import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mongo } from 'mongoose';
import { IMAGE_BUCKET_NAME, deleteStoredImages } from '@database/image-store';
import { LEGACY } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * Moves the bytes of pictures written before the image store existed into the
 * bucket, which has to happen before anything else runs: the job looks for those
 * documents in `images`, and every migration after this one has renamed that
 * collection aside.
 *
 * The same work runs today as a background job beside a serving server
 * (`modules/image/legacy-image-data.migration.ts`), and it is folded in here
 * rather than waited for. A job that runs beside a live server needs a delayed
 * start, an hourly retry, stop-aware batching and a rule for what a second
 * instance doing the same thing means; a migration that holds the boot open
 * needs none of that, and copying the machinery over would have brought it all
 * with it. Keeping the two apart also means the background job can be deleted
 * with the rest of the legacy layer without this migration changing.
 *
 * The document is the only copy of a picture until the store has answered with
 * the very same bytes, so the payload is dropped only after reading the stored
 * file back in full. A picture that lost its bytes cannot be recovered from
 * anywhere.
 */

const BATCH = 200;

type Inline = { _id: mongo.ObjectId; image_id?: string; data?: unknown };

const bytesOf = (value: unknown): Buffer | null => {
  if (Buffer.isBuffer(value)) return value;
  return value instanceof mongo.Binary ? Buffer.from(value.buffer) : null;
};

const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export const pictureBytesIntoTheBucket: MigrationStep = {
  name: '001-picture-bytes-into-the-bucket',

  async run(context: MigrationContext): Promise<void> {
    const images = await context.source(LEGACY.images);
    const bucket = new mongo.GridFSBucket(context.db, { bucketName: IMAGE_BUCKET_NAME });
    let after: mongo.ObjectId | undefined;

    for (;;) {
      const batch = await images
        .find<Inline>({ data: { $exists: true }, ...(after ? { _id: { $gt: after } } : {}) }, { projection: { image_id: 1, data: 1 } })
        .sort({ _id: 1 })
        .limit(BATCH)
        .toArray();

      if (batch.length === 0) return;

      for (const image of batch) {
        const id = typeof image.image_id === 'string' ? image.image_id : null;
        const data = bytesOf(image.data);

        if (!id || !data) {
          context.reject({
            source: LEGACY.images,
            id: id ?? String(image._id),
            reason: 'the picture carries a payload that is not bytes',
            dropped: false,
            detail: null,
          });
          continue;
        }

        context.count('images.read');
        if (context.dryRun) {
          context.count('images.bytesToMove');
          continue;
        }

        await store(bucket, context.db, id, data);
        await images.updateOne({ image_id: id }, { $unset: { data: '' }, $set: { size: data.length } });
        context.count('images.bytesMoved');
      }

      // Past the batch rather than back to the start: a document that was
      // rejected would otherwise be handed out again for the rest of the run.
      after = batch[batch.length - 1]._id;
    }
  },
};

const store = async (bucket: mongo.GridFSBucket, db: mongo.Db, id: string, data: Buffer): Promise<void> => {
  if (await readsBack(bucket, id, data)) return;

  // Whatever is in the store is not this picture: an upload that was interrupted
  // leaves chunks behind that no file document names.
  await deleteStoredImages(db, [id]);
  await pipeline(Readable.from(data), bucket.openUploadStreamWithId(id as unknown as mongo.ObjectId, id));

  if (!(await readsBack(bucket, id, data))) throw new Error(`The store does not read picture ${id} back byte for byte`);
};

const readsBack = async (bucket: mongo.GridFSBucket, id: string, data: Buffer): Promise<boolean> => {
  const stored = createHash('sha256');
  let length = 0;

  try {
    for await (const chunk of bucket.openDownloadStream(id as unknown as mongo.ObjectId)) {
      stored.update(chunk as Buffer);
      length += (chunk as Buffer).length;
    }
  } catch {
    // No file of that id, or one that cannot be read to its end: either way the
    // bytes still have to go in.
    return false;
  }

  return length === data.length && stored.digest('hex') === digest(data);
};
