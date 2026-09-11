import { jest } from '@jest/globals';
import { ImageStore } from '@database/image-store';
import { LegacyImageDataMigration } from '@modules/image/legacy-image-data.migration';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * Moving the pictures written before the image store into it. The migration has
 * no HTTP surface - it runs itself once the server is up - so `run` is called
 * here directly, against a real database holding documents written the old way.
 *
 * Those documents are written through the driver rather than through the model:
 * the payload is not part of the schema any more, which is the whole point of
 * the migration, and a picture the schema knows how to write is not a picture
 * this has anything to do with.
 */

let db: TestDatabase;
let store: ImageStore;
let migration: LegacyImageDataMigration;

const TIMESTAMP = Date.UTC(2026, 0, 20);

// One device cannot hold two stills of the same moment, so every picture a spec
// makes is a minute older than the one before it.
let nextTimestamp = TIMESTAMP;
const aMomentEarlier = () => (nextTimestamp -= 60_000);

const bytesOf = (imageId: string) => Buffer.from(`the picture of ${imageId}`.repeat(100));

/** A picture as it was written before the payload moved out of the document. */
const aLegacyImage = async (imageId: string, data = bytesOf(imageId)) => {
  await db.connection.db.collection('images').insertOne({
    image_id: imageId,
    device_id: 'a-device',
    timestamp: aMomentEarlier(),
    format: 'jpeg',
    data,
  });
  return data;
};

const storedImage = (imageId: string) => db.connection.db.collection('images').findOne({ image_id: imageId });

beforeAll(async () => {
  db = await startTestDatabase();
  store = new ImageStore(db.connection, db.images);
  migration = new LegacyImageDataMigration(db.images, store);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(() => db.reset());

describe('a picture that still carries its payload', () => {
  it('moves the bytes into the store and takes them off the document', async () => {
    const data = await aLegacyImage('legacy-still');

    const result = await migration.run();

    expect(result).toEqual({ migrated: 1, failed: 0 });
    expect((await store.download('legacy-still')).equals(data)).toBe(true);

    const document = await storedImage('legacy-still');
    expect(document?.data).toBeUndefined();
    // The document never had to record how large the picture is while it held
    // it; serving a Content-Length or a Range needs it now.
    expect(document?.size).toBe(data.length);
  });

  it('moves every one of them, and says how many', async () => {
    for (const imageId of ['one', 'two', 'three']) {
      await aLegacyImage(imageId);
    }

    expect(await migration.run()).toEqual({ migrated: 3, failed: 0 });
    expect(await db.connection.db.collection('images').countDocuments({ data: { $exists: true } })).toBe(0);
  });
});

describe('a second run', () => {
  it('finds nothing left to do and leaves the pictures where they are', async () => {
    const data = await aLegacyImage('legacy-still');
    await migration.run();

    expect(await migration.run()).toEqual({ migrated: 0, failed: 0 });
    expect((await store.download('legacy-still')).equals(data)).toBe(true);
  });

  it('has nothing to do on a database that never held one', async () => {
    await db.images.create({ image_id: 'modern-still', device_id: 'a-device', timestamp: aMomentEarlier(), format: 'jpeg', size: 7 });
    await store.upload('modern-still', Buffer.from('a still'));

    expect(await migration.run()).toEqual({ migrated: 0, failed: 0 });
    expect((await store.download('modern-still')).toString()).toBe('a still');
    expect((await storedImage('modern-still'))?.size).toBe(7);
  });
});

describe('a run that was interrupted', () => {
  it('finishes a picture whose bytes are already in the store', async () => {
    const data = await aLegacyImage('half-migrated');
    await store.upload('half-migrated', data);

    expect(await migration.run()).toEqual({ migrated: 1, failed: 0 });
    expect((await store.download('half-migrated')).equals(data)).toBe(true);
    expect((await storedImage('half-migrated'))?.data).toBeUndefined();
  });

  it('replaces stored bytes that are not the picture', async () => {
    const data = await aLegacyImage('half-written');
    await store.upload('half-written', data.subarray(0, 10));

    expect(await migration.run()).toEqual({ migrated: 1, failed: 0 });
    expect((await store.download('half-written')).equals(data)).toBe(true);
  });
});

describe('a picture the store will not take', () => {
  it('keeps the payload on the document, and comes back to it', async () => {
    const data = await aLegacyImage('unstorable');
    // An upload that reports success without storing anything: the picture is
    // only in the document, and dropping it there would be the end of it.
    const upload = jest.spyOn(store, 'upload').mockResolvedValue(undefined);

    expect(await migration.run()).toEqual({ migrated: 0, failed: 1 });
    expect((await storedImage('unstorable'))?.data?.buffer).toEqual(data);

    upload.mockRestore();

    expect(await migration.run()).toEqual({ migrated: 1, failed: 0 });
    expect((await store.download('unstorable')).equals(data)).toBe(true);
  });

  it('moves the pictures around it all the same', async () => {
    await aLegacyImage('unstorable');
    const data = await aLegacyImage('storable');
    const upload = jest.spyOn(store, 'upload').mockImplementation(async (imageId, bytes) => {
      if (imageId === 'unstorable') {
        throw new Error('the store is having a bad day');
      }
      return ImageStore.prototype.upload.call(store, imageId, bytes);
    });

    expect(await migration.run()).toEqual({ migrated: 1, failed: 1 });
    expect((await store.download('storable')).equals(data)).toBe(true);

    upload.mockRestore();
  });
});
