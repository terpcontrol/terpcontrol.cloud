import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough, Readable, pipeline as pipe } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Connection, mongo } from 'mongoose';
import { logger } from '@utils/logger';
import { storageConfig } from '../config/configuration';
import { S3Objects, sharedS3Objects } from './s3-objects';

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
 * The `media` document keeps everything the queries need (camera, kind, window,
 * instant) and stores no bytes; the file carries that row's `id` as its `_id`,
 * so no extra field is needed to pair the two.
 *
 * `images` and `media` share this bucket on purpose. The migration rewrites the
 * documents that point at the bytes and never the bytes themselves - a `media`
 * row keeps the `image_id` of the row it was made from as its own `id` - so a
 * picture stays exactly where it is and is addressed here by either id. Which
 * collection an id came from is nothing the store has to know, and a second
 * bucket would mean copying nearly the whole disk to learn it.
 *
 * With `S3_BUCKET` set the bytes go to that bucket instead, under the same id.
 * GridFS stays the fallback for reading, listing and deleting, so an install
 * that switches serves every picture it already has while `media:to-s3` moves
 * them over, and needs no step in between.
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
 * Drop the files of the given images from GridFS. Deleting one at a time costs
 * two round trips per picture, which is why the thinning and cleanup batches go
 * straight at the two collections the bucket is made of - the same documents
 * `GridFSBucket.delete` removes.
 */
export const deleteGridFsFiles = async (db: mongo.Db, pictureIds: string[]): Promise<void> => {
  if (pictureIds.length === 0) {
    return;
  }

  const ids = pictureIds.map(fileId);
  await db.collection(`${IMAGE_BUCKET_NAME}.chunks`).deleteMany({ files_id: { $in: ids } });
  await db.collection(`${IMAGE_BUCKET_NAME}.files`).deleteMany({ _id: { $in: ids } });
};

/**
 * Drop the bytes of the given pictures wherever they are: GridFS always, the
 * bucket as well when one is configured.
 *
 * Free of the provider so the schema can call it from a delete hook, where
 * there is nothing to inject but the model's own connection - which is why it
 * reads the setting itself.
 */
export const deleteStoredImages = async (db: mongo.Db, pictureIds: string[], s3 = storageConfig().s3): Promise<void> => {
  if (pictureIds.length === 0) {
    return;
  }

  if (s3) await sharedS3Objects(s3).delete(pictureIds);
  await deleteGridFsFiles(db, pictureIds);
};

/**
 * A readable handed out at once over bytes that are only found asynchronously -
 * a GetObject answers before its body flows. Destroying it, as a client that
 * hangs up does, destroys the source with it.
 */
const deferred = (open: () => Promise<Readable>): Readable => {
  const out = new PassThrough();
  open().then(
    source => pipe(source, out, () => undefined),
    (e: Error) => out.destroy(e),
  );
  return out;
};

/**
 * The bytes and nothing else. Which collection points at a file - `media` today,
 * `images` before the migration - is the caller's to know, and each of them
 * writes its own row around a file put here.
 */
@Injectable()
export class ImageStore implements OnModuleInit {
  private readonly s3: S3Objects | null;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(storageConfig.KEY) storage?: ConfigType<typeof storageConfig>,
    /** For the specs, which stand in for the service. */
    @Optional() objects?: S3Objects,
  ) {
    this.s3 = objects ?? (storage?.s3 ? sharedS3Objects(storage.s3) : null);
  }

  /**
   * Said once at boot, and checked: a bucket that cannot be reached fails every
   * capture, which is worth a line in the log before the first one does. It does
   * not keep the server from starting - readings and alarms need no bucket.
   */
  public async onModuleInit(): Promise<void> {
    if (!this.s3) return;
    try {
      await this.s3.verifyBucket();
      logger.info('Pictures and films are stored in the S3 bucket; GridFS is read for what is still there.');
    } catch (e) {
      logger.error(`The S3 bucket for pictures and films cannot be reached: ${e}`);
    }
  }

  /** The driver's handle, which a connection only carries once it is open - and nothing is served before it is. */
  private get db(): mongo.Db {
    return this.connection.db!;
  }

  private bucket(): mongo.GridFSBucket {
    return new mongo.GridFSBucket(this.db, { bucketName: IMAGE_BUCKET_NAME });
  }

  /** Store the bytes of a picture under the id of the document that indexes it. */
  public async upload(pictureId: string, data: Buffer): Promise<void> {
    if (this.s3) return this.s3.put(pictureId, data, data.length);
    await pipeline(Readable.from(data), this.bucket().openUploadStreamWithId(fileId(pictureId), pictureId));
  }

  /**
   * Store a file that is already on disk, without reading it into memory, and
   * answer its size. This is how a timelapse gets in: ffmpeg has just written it
   * and it can run to tens of megabytes.
   */
  public async uploadFile(pictureId: string, path: string): Promise<number> {
    const { size } = await stat(path);
    if (this.s3) {
      await this.s3.put(pictureId, createReadStream(path), size);
    } else {
      await pipeline(createReadStream(path), this.bucket().openUploadStreamWithId(fileId(pictureId), pictureId));
    }
    return size;
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
    const s3 = this.s3;
    if (!s3) return this.readGridFs(pictureId, range);
    return deferred(async () => (await s3.get(pictureId, range)) ?? this.readGridFs(pictureId, range));
  }

  private readGridFs(pictureId: string, range?: { start: number; end: number }): Readable {
    return this.bucket().openDownloadStream(fileId(pictureId), range ? { start: range.start, end: range.end + 1 } : undefined);
  }

  /** Write the picture straight to disk, without holding it in memory. */
  public async copyToFile(pictureId: string, path: string): Promise<void> {
    await pipeline(this.read(pictureId), createWriteStream(path));
  }

  /**
   * The ids of every file stored before `uploadedBefore`, for the cleanup that
   * hunts for files whose document is gone - in the bucket and in GridFS, which
   * may still hold some. Not in any order the caller can rely on.
   */
  public async *listFileIds(uploadedBefore: number): AsyncIterable<string> {
    if (this.s3) yield* this.s3.list(uploadedBefore);
    yield* this.db
      .collection(`${IMAGE_BUCKET_NAME}.files`)
      .find({ uploadDate: { $lt: new Date(uploadedBefore) } }, { projection: { _id: 1 }, sort: { uploadDate: 1 } })
      .map(file => String(file._id));
  }

  public async delete(pictureIds: string[]): Promise<void> {
    if (pictureIds.length === 0) return;
    if (this.s3) await this.s3.delete(pictureIds);
    await deleteGridFsFiles(this.db, pictureIds);
  }
}
