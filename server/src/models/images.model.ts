import { Document, model, Schema } from 'mongoose';
import { Image } from '@fg2/shared-types';

const imagesSchema: Schema = new Schema({
  image_id: {
    type: String,
    required: true,
    unique: true,
  },
  // Optional since a photograph can belong to a tent that has no device at all;
  // exactly one of device_id and zelt_id identifies where a row belongs.
  device_id: {
    type: String,
    required: false,
  },
  // Written on every new row. A row from before this field resolves through the
  // tent that binds its device_id, so no backfill is required to read one. Its
  // index is declared with the other new ones in the index migration, not here,
  // so a boot never starts an index build over the whole collection.
  zelt_id: {
    type: String,
    required: false,
  },
  timestamp: {
    type: Number,
    required: true,
  },
  timestampEnd: {
    type: Number,
    required: false,
  },
  data: {
    type: Buffer,
    required: true,
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

const imageModel = model<Image & Document>('Image', imagesSchema);
void imageModel.createIndexes();

export default imageModel;
