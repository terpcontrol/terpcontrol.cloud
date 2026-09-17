import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Connection, Document, Model, mongo } from 'mongoose';
import { Image } from '@fg2/shared-types';
import { MODEL } from './models';

/**
 * Where the bytes of a still or a timelapse live.
 *
 * They used to sit in the `images` document itself, which capped a picture at
 * the 16 MiB a BSON document holds - and in practice a little lower, because the
 * driver serializes into a fixed 17 MiB buffer and overruns it with a bare
 * "RangeError: offset is out of bounds". A day of 2304x1296 stills encodes to
 * about 60 MiB, so timelapses stopped being storable at all once the cameras got
 * bigger. GridFS splits the payload across chunk documents instead, which lifts
 * the limit and lets a picture be read and written as a stream rather than as one
 * buffer the size of the whole file.
 *
 * The `images` document keeps everything the queries need (device, format,
 * timestamp, duration) and stores no bytes; the file carries the same
 * `image_id` as its `_id`, so no extra field is needed to pair the two.
 *
 * `images` and `media` share this bucket on purpose. The migration rewrites the
 * documents that point at the bytes and never the bytes themselves - a `media`
 * row keeps the `image_id` of the row it was made from as its own `id` - so a
 * picture stays exactly where it is and is addressed here by either id. Which
 * collection an id came from is nothing the store has to know, and a second
 * bucket would mean copying nearly the whole disk to learn it.
 */

/**
 * `imagedata.files` / `imagedata.chunks`, next to the documents that index them.
 *
 * Exported because the bucket outlives the collections that point into it: the
 * migration moves the last inline payloads in and the rollback has to leave the
 * bucket alone, and neither of those goes through this provider.
 */
export const IMAGE_BUCKET_NAME = 'imagedata';

/**
 * GridFS ids are typed as ObjectId, but the spec leaves `files._id` to the
 * application and the driver passes it through untouched. Using the id of the
 * document that points at the file - an `images.image_id` or the `media.id` it
 * becomes - keeps the collections trivially joinable and orphans trivially
 * findable.
 */
const fileId = (pictureId: string) => pictureId as unknown as mongo.ObjectId;

/**
 * Drop the files of the given images. Deleting one at a time costs two round
 * trips per picture, which is why the thinning and cleanup batches go straight
 * at the two collections the bucket is made of - the same documents
 * `GridFSBucket.delete` removes.
 *
 * Free of the provider so the schema can call it from a delete hook, where
 * there is nothing to inject but the model's own connection.
 */
export const deleteStoredImages = async (db: mongo.Db, pictureIds: string[]): Promise<void> => {
  if (pictureIds.length === 0) {
    return;
  }

  const ids = pictureIds.map(fileId);
  await db.collection(`${IMAGE_BUCKET_NAME}.chunks`).deleteMany({ files_id: { $in: ids } });
  await db.collection(`${IMAGE_BUCKET_NAME}.files`).deleteMany({ _id: { $in: ids } });
};

@Injectable()
export class ImageStore {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
  ) {}

  /** The driver's handle, which a connection only carries once it is open - and nothing is served before it is. */
  private get db(): mongo.Db {
    return this.connection.db!;
  }

  private bucket(): mongo.GridFSBucket {
    return new mongo.GridFSBucket(this.db, { bucketName: IMAGE_BUCKET_NAME });
  }

  /** Store the bytes of a picture under the id of the document that indexes it. */
  public async upload(pictureId: string, data: Buffer): Promise<void> {
    await pipeline(Readable.from(data), this.bucket().openUploadStreamWithId(fileId(pictureId), pictureId));
  }

  /**
   * Store a file that is already on disk, without reading it into memory, and
   * answer its size. This is how a timelapse gets in: ffmpeg has just written it
   * and it can run to tens of megabytes.
   */
  public async uploadFile(pictureId: string, path: string): Promise<number> {
    await pipeline(createReadStream(path), this.bucket().openUploadStreamWithId(fileId(pictureId), pictureId));
    return (await stat(path)).size;
  }

  /** The whole picture in memory. Prefer `read`/`copyToFile` for anything big. */
  public async download(pictureId: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.read(pictureId)) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /**
   * A readable over the stored bytes, optionally over one byte range only
   * (inclusive `end`, as an HTTP Range header counts).
   */
  public read(pictureId: string, range?: { start: number; end: number }): Readable {
    return this.bucket().openDownloadStream(fileId(pictureId), range ? { start: range.start, end: range.end + 1 } : undefined);
  }

  /** Write the picture straight to disk, without holding it in memory. */
  public async copyToFile(pictureId: string, path: string): Promise<void> {
    await pipeline(this.read(pictureId), createWriteStream(path));
  }

  /**
   * The ids of every file stored before `uploadedBefore`, for the cleanup that
   * hunts for files whose document is gone. Oldest first, as a cursor: the bucket
   * holds one entry per picture and there is no reason to list them all at once.
   */
  public listFileIds(uploadedBefore: number): AsyncIterable<string> {
    return this.db
      .collection(`${IMAGE_BUCKET_NAME}.files`)
      .find({ uploadDate: { $lt: new Date(uploadedBefore) } }, { projection: { _id: 1 }, sort: { uploadDate: 1 } })
      .map(file => String(file._id));
  }

  public delete(pictureIds: string[]): Promise<void> {
    return deleteStoredImages(this.db, pictureIds);
  }

  /**
   * Write one picture: the bytes into the store, everything the queries run on
   * into the collection. Two writes rather than one, so the bytes are dropped
   * again if the document does not make it - a failed write leaves nothing
   * behind either way.
   */
  public createImage(image: Omit<Image, 'size'>, data: Buffer): Promise<Image> {
    return this.writeImage(image, () => this.upload(image.image_id, data).then(() => data.length));
  }

  /** The same, for a picture that is already a file on disk (a fresh timelapse). */
  public createImageFromFile(image: Omit<Image, 'size'>, path: string): Promise<Image> {
    return this.writeImage(image, () => this.uploadFile(image.image_id, path));
  }

  private async writeImage(image: Omit<Image, 'size'>, upload: () => Promise<number>): Promise<Image> {
    const size = await upload();

    try {
      return await this.images.create({ ...image, size });
    } catch (e) {
      await this.delete([image.image_id]).catch(() => undefined);
      throw e;
    }
  }
}
