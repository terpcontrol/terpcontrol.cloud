import { Document, model, Schema } from 'mongoose';
import { Image } from '@fg2/shared-types';
import { baueIndexe } from '@utils/indexe';

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
// is told not to, and it does that silently, on every connection, with no way
// to see or handle a failure. Over the collection that holds every JPEG ever
// taken the build is explicit instead - see the note on the declarations below.
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
 * Declared here, built at boot by `baueIndexe` below as far as building alone
 * gets - the rest is `npm run migrate:indexes`, which is the only thing that
 * ever drops.
 *
 * The split is not a preference, it is what `createIndexes()` can do: it
 * creates and never alters. Three of the four declarations below are purely
 * additive, so creating them is idempotent and safe on every boot of every
 * instance. The fourth *narrows* an index that already exists on a deployment
 * old enough to have the unrestricted one, and narrowing means dropping first -
 * a drop in a boot path races the second pm2 instance (D3), so on such a
 * database that one create fails, says so in the log, and waits for the
 * operator script. On a database that never had the old index there is nothing
 * to drop and it is created here like the others, which is what keeps a fresh
 * deployment from running with no `Image` indexes at all.
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
// The unique `image_id` is what makes `findOne({ image_id })` a lookup rather
// than a scan of every JPEG in the collection, and what stops two rows sharing
// an id - which the image read path resolves by, so a duplicate is a picture
// served in place of another.
baueIndexe(imageModel);

export default imageModel;
