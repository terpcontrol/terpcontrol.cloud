import { Query, Schema } from 'mongoose';
import { logger } from '@utils/logger';
import { deleteStoredImages } from '../image-store';

export const imagesSchema: Schema = new Schema({
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
    await deleteStoredImages(this.model.db.db, imageIds);
  } catch (e) {
    logger.error(`Failed deleting the stored data of ${imageIds.length} image(s): ${e}`);
  }
}

for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  imagesSchema.pre(operation, { query: true, document: false }, collectImageIds);
  imagesSchema.post(operation, { query: true, document: false }, purgeStoredImages);
}
