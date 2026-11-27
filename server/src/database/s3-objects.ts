import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { S3Settings } from '../config/configuration';

/** What of the client this file uses, so a spec can stand in for the service. */
export type S3Sender = Pick<S3Client, 'send'>;

/** DeleteObjects takes at most this many keys per request. */
const DELETE_BATCH = 1000;

const isMissing = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

export const s3Client = (settings: S3Settings): S3Client =>
  new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    credentials:
      settings.accessKeyId && settings.secretAccessKey ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } : undefined,
    // The SDK's default checksums are AWS-only headers and trailers that a good
    // part of the S3-compatible services refuse; a checksum is still sent where
    // the API requires one (DeleteObjects).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

/**
 * The pictures in a bucket, one object per picture, keyed by the prefix and the
 * media row's `id` - the same id GridFS files them under, so moving a picture
 * between the two changes nothing else.
 *
 * The prefix belongs to this install alone: the orphan sweep deletes whatever
 * under it no media row names.
 */
export class S3Objects {
  constructor(
    private readonly client: S3Sender,
    private readonly settings: S3Settings,
  ) {}

  private key(id: string): string {
    return `${this.settings.prefix}${id}`;
  }

  public async verifyBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
  }

  public async put(id: string, body: Buffer | Readable, length: number): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: this.key(id), Body: body, ContentLength: length }));
  }

  /** The size of a stored object, or `null` when there is none. */
  public async size(id: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: this.key(id) }));
      return head.ContentLength ?? null;
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  /** The bytes, optionally one inclusive range of them, or `null` when the object is not there. */
  public async get(id: string, range?: { start: number; end: number }): Promise<Readable | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(id), Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
      );
      return object.Body as Readable;
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  /** The ids of the objects last written before the given instant, in key order. */
  public async *list(writtenBefore: number): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.settings.bucket, Prefix: this.settings.prefix, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified && object.LastModified.getTime() < writtenBefore) {
          yield object.Key.slice(this.settings.prefix.length);
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  public async delete(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const objects = ids.slice(i, i + DELETE_BATCH).map(id => ({ Key: this.key(id) }));
      const result = await this.client.send(new DeleteObjectsCommand({ Bucket: this.settings.bucket, Delete: { Objects: objects, Quiet: true } }));
      // A key that is not there is no error to S3; what is listed here is a
      // delete the service refused.
      if (result.Errors?.length) {
        throw new Error(`S3 refused deleting ${result.Errors.length} object(s): ${result.Errors[0].Key}: ${result.Errors[0].Message}`);
      }
    }
  }
}

/** One client per bucket setting and process: a client carries a connection pool. */
let shared: { key: string; objects: S3Objects } | undefined;

export const sharedS3Objects = (settings: S3Settings): S3Objects => {
  const key = JSON.stringify(settings);
  if (shared?.key !== key) shared = { key, objects: new S3Objects(s3Client(settings), settings) };
  return shared.objects;
};
