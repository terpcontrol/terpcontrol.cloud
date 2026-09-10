import { Document, model, Query, Schema } from 'mongoose';
import { Image } from '@fg2/shared-types';
import { imageStore } from '@/databases/imagestore';

const imagesSchema: Schema = new Schema({
  image_id: {
    type: String,
    required: true,
    unique: true,
  },
  device_id: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Number,
    required: true,
  },
  timestampEnd: {
    type: Number,
    required: false,
  },
  // What a picture written before the move to GridFS carries. Still read, never
  // written: the bytes live in the image store now, under the same image_id.
  data: {
    type: Buffer,
    required: false,
  },
  // Bytes of the stored picture, so the size can be served (Content-Length, the
  // end of a Range) without asking the store for the file's metadata first.
  size: {
    type: Number,
    required: false,
  },
  format: {
    type: String,
    enum: ['jpeg', 'mp4', 'user/jpeg'],
    required: true,
  },
  duration: {
    type: String,
    enum: ['1d', '1w', '1m'],
    required: false,
  },
});

imagesSchema.index({ device_id: 1, format: 1, timestamp: -1, duration: 1 }, { unique: true });

// Pictures are deleted from half a dozen places - retention, thinning, the
// timelapse that replaces its predecessor, the cleanup of removed devices, the
// user deleting a diary photo. Hanging the store off the delete itself is what
// keeps every one of them from leaving the bytes behind.
type PurgingQuery = Query<unknown, unknown> & { _imageIdsToPurge?: string[] };

async function collectImageIds(this: PurgingQuery) {
  const doomed = await this.model.find(this.getFilter()).select({ image_id: 1, _id: 0 }).lean<{ image_id: string }[]>();
  this._imageIdsToPurge = doomed.map(image => image.image_id);
}

async function purgeStoredImages(this: PurgingQuery) {
  const imageIds = this._imageIdsToPurge ?? [];
  this._imageIdsToPurge = undefined;

  // The documents are already gone; failing here would only strand the bytes,
  // which the caller can do nothing about and which must not fail its delete.
  try {
    await imageStore.delete(imageIds);
  } catch (e) {
    console.log(`Failed deleting the stored data of ${imageIds.length} image(s):`, e);
  }
}

for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  imagesSchema.pre(operation, { query: true, document: false }, collectImageIds);
  imagesSchema.post(operation, { query: true, document: false }, purgeStoredImages);
}

const imageModel = model<Image & Document>('Image', imagesSchema);
void imageModel.createIndexes();

/**
 * Write one picture: the bytes into the image store, everything the queries run
 * on into this collection. Two writes rather than one, so the bytes are dropped
 * again if the document does not make it - a failed write leaves nothing behind
 * either way.
 */
export async function createImage(image: Omit<Image, 'data' | 'size'>, data: Buffer): Promise<Image> {
  return writeImage(image, () => imageStore.upload(image.image_id, data).then(() => data.length));
}

/** The same, for a picture that is already a file on disk (a fresh timelapse). */
export async function createImageFromFile(image: Omit<Image, 'data' | 'size'>, path: string): Promise<Image> {
  return writeImage(image, () => imageStore.uploadFile(image.image_id, path));
}

async function writeImage(image: Omit<Image, 'data' | 'size'>, upload: () => Promise<number>): Promise<Image> {
  const size = await upload();

  try {
    return await imageModel.create({ ...image, size });
  } catch (e) {
    await imageStore.delete([image.image_id]).catch(() => undefined);
    throw e;
  }
}

export default imageModel;
