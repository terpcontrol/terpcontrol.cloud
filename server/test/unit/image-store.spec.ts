import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { S3Settings } from '@config/configuration';
import { ImageStore } from '@database/image-store';
import { moveMediaToS3 } from '@database/media-to-s3';
import { S3Objects, S3Sender, s3Client } from '@database/s3-objects';
import { useV1TestDatabase } from './support/v1-database';

/**
 * The image store on an S3 bucket, and the move of what GridFS holds into it.
 *
 * Against an in-memory stand-in for the commands the store sends, unless
 * `TEST_S3_ENDPOINT` names a real service (a local MinIO, say, with
 * `TEST_S3_ACCESS_KEY_ID` / `TEST_S3_SECRET_ACCESS_KEY`); the bucket is created
 * there, and every run writes under a prefix of its own.
 */

const db = useV1TestDatabase();

type Stored = { body: Buffer; lastModified: Date };

const collect = async (body: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
};

const missing = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

/** The six commands the store sends, as S3 answers them. */
const memoryS3 = (objects: Map<string, Stored>): S3Sender => ({
  send: (async (command: { constructor: { name: string }; input: Record<string, any> }) => {
    const { input } = command;
    switch (command.constructor.name) {
      case 'HeadBucketCommand':
        return {};
      case 'PutObjectCommand':
        objects.set(input.Key, { body: await collect(input.Body), lastModified: new Date() });
        return {};
      case 'HeadObjectCommand': {
        const object = objects.get(input.Key);
        if (!object) throw missing('NotFound');
        return { ContentLength: object.body.length };
      }
      case 'GetObjectCommand': {
        const object = objects.get(input.Key);
        if (!object) throw missing('NoSuchKey');
        const [, start, end] = /bytes=(\d+)-(\d+)/.exec(input.Range ?? '') ?? [];
        return { Body: Readable.from([start === undefined ? object.body : object.body.subarray(Number(start), Number(end) + 1)]) };
      }
      case 'ListObjectsV2Command':
        return {
          Contents: [...objects.entries()]
            .filter(([key]) => key.startsWith(input.Prefix ?? ''))
            .map(([Key, object]) => ({ Key, LastModified: object.lastModified })),
        };
      case 'DeleteObjectsCommand':
        for (const { Key } of input.Delete.Objects) objects.delete(Key);
        return {};
      default:
        throw new Error(`The stand-in does not answer ${command.constructor.name}`);
    }
  }) as S3Sender['send'],
});

const real = process.env.TEST_S3_ENDPOINT;
const settings: S3Settings = {
  bucket: process.env.TEST_S3_BUCKET ?? 'terpcontrol-test',
  region: 'us-east-1',
  endpoint: real,
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY,
  forcePathStyle: true,
  prefix: `media-${randomUUID()}/`,
};

const memory = new Map<string, Stored>();
let objects: S3Objects;
let store: ImageStore;
let gridFs: ImageStore;

const gridFsIds = async (): Promise<string[]> =>
  (
    await db.connection
      .db!.collection('imagedata.files')
      .find({}, { projection: { _id: 1 } })
      .toArray()
  )
    .map(file => String(file._id))
    .sort();

const s3Ids = async (): Promise<string[]> => {
  const ids: string[] = [];
  for await (const id of objects.list(Date.now() + 60_000)) ids.push(id);
  return ids.sort();
};

const readAll = async (stream: Readable): Promise<string> => (await collect(stream)).toString();

beforeAll(async () => {
  let client: S3Sender = memoryS3(memory);
  if (real) {
    const s3 = s3Client(settings);
    await s3.send(new CreateBucketCommand({ Bucket: settings.bucket })).catch((e: Error) => {
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e.name)) throw e;
    });
    client = s3 as S3Client;
  }
  objects = new S3Objects(client, settings);
  store = new ImageStore(db.connection, { s3: settings }, objects);
  gridFs = new ImageStore(db.connection);
});

beforeEach(async () => {
  await db.reset();
  await objects.delete(await s3Ids());
});

describe('the store on S3', () => {
  it('writes new pictures to the bucket only, and reads them whole and by range', async () => {
    await store.upload('still', Buffer.from('0123456789'));

    expect(await s3Ids()).toEqual(['still']);
    expect(await gridFsIds()).toEqual([]);
    expect((await store.download('still')).toString()).toBe('0123456789');
    expect(await readAll(store.read('still', { start: 2, end: 5 }))).toBe('2345');
  });

  it('stores a file from disk and answers its size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'image-store-'));
    try {
      await writeFile(join(dir, 'film.mp4'), Buffer.alloc(300_000, 7));
      expect(await store.uploadFile('film', join(dir, 'film.mp4'))).toBe(300_000);

      await store.copyToFile('film', join(dir, 'back.mp4'));
      expect((await readFile(join(dir, 'back.mp4'))).equals(Buffer.alloc(300_000, 7))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serves what is still in GridFS, and fails on what is in neither', async () => {
    await gridFs.upload('from-before', Buffer.from('old picture'));

    expect(await readAll(store.read('from-before'))).toBe('old picture');
    expect(await readAll(store.read('from-before', { start: 4, end: 10 }))).toBe('picture');
    await expect(store.download('nowhere')).rejects.toThrow();
  });

  it('lists and deletes in both places', async () => {
    await gridFs.upload('in-gridfs', Buffer.from('a'));
    await store.upload('in-s3', Buffer.from('b'));
    await store.upload('kept', Buffer.from('c'));

    const listed: string[] = [];
    for await (const id of store.listFileIds(Date.now() + 60_000)) listed.push(id);
    expect(listed.sort()).toEqual(['in-gridfs', 'in-s3', 'kept']);

    const none: string[] = [];
    for await (const id of store.listFileIds(Date.now() - 60_000)) none.push(id);
    expect(none).toEqual([]);

    await store.delete(['in-gridfs', 'in-s3']);
    expect(await s3Ids()).toEqual(['kept']);
    expect(await gridFsIds()).toEqual([]);
  });
});

describe('moving GridFS into the bucket', () => {
  const quiet = () => undefined;

  it('copies every file, checks it and empties GridFS', async () => {
    await gridFs.upload('a', Buffer.from('first'));
    // Bigger than one GridFS chunk (255 KiB), so the copy is made of several.
    await gridFs.upload('b', Buffer.alloc(600_000, 3));

    const outcome = await moveMediaToS3(db.connection.db!, objects, { keep: false, report: quiet });

    expect(outcome).toMatchObject({ files: 2, uploaded: 2, inS3: 2, bytes: 600_005, failed: [] });
    expect(await gridFsIds()).toEqual([]);
    expect(await db.connection.db!.collection('imagedata.chunks').countDocuments()).toBe(0);
    expect(await s3Ids()).toEqual(['a', 'b']);
    expect((await store.download('b')).equals(Buffer.alloc(600_000, 3))).toBe(true);
  });

  it('leaves GridFS alone with keep, and uploads nothing twice when run again', async () => {
    await gridFs.upload('a', Buffer.from('first'));

    await moveMediaToS3(db.connection.db!, objects, { keep: true, report: quiet });
    expect(await gridFsIds()).toEqual(['a']);

    const again = await moveMediaToS3(db.connection.db!, objects, { keep: false, report: quiet });
    expect(again).toMatchObject({ files: 1, uploaded: 0, inS3: 1 });
    expect(await gridFsIds()).toEqual([]);
    expect((await store.download('a')).toString()).toBe('first');
  });
});
