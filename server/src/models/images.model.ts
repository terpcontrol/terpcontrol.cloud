import { Document, model, Schema } from 'mongoose';
import { Image } from '@fg2/shared-types';

const imagesSchema: Schema = new Schema({
  image_id: {
    type: String,
    required: true,
    unique: true,
  },
  // Optional since a photograph can belong to a tent that has no device at all;
  // exactly one of device_id and zelt_id identifies where a row belongs, which
  // the validator below enforces rather than leaves as a hope.
  device_id: {
    type: String,
    required: false,
  },
  // Written on every new row. A row from before this field resolves through the
  // tent that binds its device_id, so no backfill is required to read one.
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

// Mongoose builds a schema's indexes as soon as the connection opens unless it
// is told not to. Over the collection that holds every JPEG ever taken that is
// an operator's decision, not a side effect of booting - see the note on the
// index declarations below.
imagesSchema.set('autoIndex', false);

/**
 * A row belongs to a device or to a tent, never to both and never to neither.
 *
 * Neither is the one that cannot be recovered from. Every read asks for one of
 * the two keys, so a row carrying neither matches no query ever again: it is
 * stored, it counts against the owner's quota, and it is invisible. The whole
 * two-keyed read rests on this being true, so it is checked where the write is
 * rather than at each of the call sites that could forget.
 */
imagesSchema.pre('validate', function (next) {
  const schluessel = ['device_id', 'zelt_id'].filter(feld => {
    const wert = this.get(feld);
    return typeof wert === 'string' && wert.trim() !== '';
  });

  if (schluessel.length !== 1) {
    this.invalidate('zelt_id', 'an image needs exactly one of device_id and zelt_id');
  }

  next();
});

/**
 * Declared here, applied by `npm run migrate:indexes` — never by a boot.
 *
 * `createIndexes()` creates and never alters, so narrowing the unique index
 * below means dropping the old one first, and a drop in a boot path races the
 * second pm2 instance and swallows its own failure (D3). That is also why this
 * module neither calls `baueIndexe` nor leaves `autoIndex` on: a boot builds no
 * index here at all, and a fresh deployment gets them from the same one-shot
 * script an upgrade does.
 */
imagesSchema.index({ zelt_id: 1, timestamp: -1 });

// The read path for rows keyed by device, which the unique index below served
// until it was narrowed to mp4 and stopped answering for stills and photographs.
imagesSchema.index({ device_id: 1, format: 1, timestamp: -1 });

// One timelapse per device, format, start and window — the single consumer that
// ever wanted this uniqueness (`image.service.compressRtspStreamImages`).
// Unrestricted it also made two photographs taken in different tents in the same
// millisecond collide, because a device-less row keys on `device_id: null` (D2).
imagesSchema.index({ device_id: 1, format: 1, timestamp: -1, duration: 1 }, { unique: true, partialFilterExpression: { format: 'mp4' } });

const imageModel = model<Image & Document>('Image', imagesSchema);

export default imageModel;
