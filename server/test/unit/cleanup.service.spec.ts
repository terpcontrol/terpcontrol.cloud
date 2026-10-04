import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { ImageStore } from '@database/image-store';
import { MODEL_V1 } from '@database/models';
import { StoredUser, usersSchema } from '@database/schemas/v1/users.schema';
import { CleanupService } from '@modules/cleanup/cleanup.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The daily sweep has no HTTP surface of its own, so the black-box suite cannot
 * reach it: `run` is called here directly, against a real database, with `now`
 * chosen per case so the seven-day grace period can be crossed without waiting.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 20);
/** Past the grace period, so a record that is unreachable is also collectable. */
const OLD = new Date(NOW - 30 * DAY_MS);
/** Unreachable, but too recent to collect. */
const RECENT = new Date(NOW - 2 * DAY_MS);

let db: V1TestDatabase;
let users: Model<StoredUser>;
let store: ImageStore;
let cleanup: CleanupService;

const anEntry = (id: string, createdAt: Date, rest: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  kind: 'system',
  occurredAt: createdAt,
  source: 'device',
  values: { kind: 'system' },
  ...rest,
});

const aPicture = (id: string, createdAt: Date, rest: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  kind: 'still',
  mime: 'image/jpeg',
  bytes: 1,
  capturedAt: createdAt,
  ...rest,
});

const aGrow = (id: string, rest: Record<string, unknown> = {}) => ({
  id,
  ownerId: 'owner',
  name: id,
  type: 'photoperiod',
  slug: id,
  startedAt: OLD,
  ...rest,
});

/** Store bytes for a picture and date the file, which is what the sweep reads. */
const storeBytes = async (mediaId: string, uploadedAt: Date) => {
  await store.upload(mediaId, Buffer.from(`bytes of ${mediaId}`));
  // A file carries the media id as its `_id`, where the driver's types expect an
  // ObjectId - the store writes it the same way.
  const fileId = mediaId as unknown as ObjectId;
  await db.connection.db!.collection('imagedata.files').updateOne({ _id: fileId }, { $set: { uploadDate: uploadedAt } });
};

const storedFileIds = async (): Promise<string[]> => {
  const files = await db.connection
    .db!.collection('imagedata.files')
    .find({}, { projection: { _id: 1 } })
    .toArray();
  return files.map(file => String(file._id)).sort();
};

const remainingEntries = async (): Promise<string[]> => (await db.entries.find().lean()).map(entry => entry.id).sort();
const remainingMedia = async (): Promise<string[]> => (await db.media.find().lean()).map(media => media.id).sort();

beforeAll(async () => {
  db = await startV1TestDatabase();
  users = db.connection.model<StoredUser>(MODEL_V1.user, usersSchema);
  store = new ImageStore(db.connection);
  cleanup = new CleanupService(db.devices, db.spaces, db.grows, db.cameras, users, db.entries, db.media, store);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(() => db.reset());

describe('camera capture diagnostics', () => {
  it('deletes the successful ones whatever their age, and keeps the failures', async () => {
    await db.entries.create([
      anEntry('ok-now', new Date(NOW), { message: { key: 'message-cam-capture', params: ['ok 42ms'] } }),
      anEntry('ok-old', OLD, { message: { key: 'message-cam-capture', params: ['ok 51ms'] } }),
      anEntry('failed', new Date(NOW), { message: { key: 'message-cam-capture', params: ['failed timeout'] } }),
      anEntry('another-key', new Date(NOW), { message: { key: 'message-cam-reset', params: ['ok'] } }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedCamDiagnostics).toBe(2);
    expect(await remainingEntries()).toEqual(['another-key', 'failed']);
  });
});

describe('entries nothing can reach', () => {
  it('deletes those whose grow, space and device are all gone', async () => {
    await db.devices.create({ id: 'kept-device', type: 'controller' });
    await db.spaces.create({ id: 'kept-space', ownerId: 'owner', kind: 'tent', name: 'The tent' });
    await db.grows.create(aGrow('kept-grow'));
    await db.entries.create([
      anEntry('of-a-device', OLD, { deviceId: 'kept-device' }),
      anEntry('of-a-space', OLD, { spaceId: 'kept-space', deviceId: 'gone-device' }),
      anEntry('of-a-grow', OLD, { growId: 'kept-grow', spaceId: 'gone-space' }),
      anEntry('of-nothing-left', OLD, { growId: 'gone-grow', spaceId: 'gone-space', deviceId: 'gone-device' }),
      anEntry('inside-the-grace-period', RECENT, { deviceId: 'gone-device' }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedEntries).toBe(1);
    expect(await remainingEntries()).toEqual(['inside-the-grace-period', 'of-a-device', 'of-a-grow', 'of-a-space']);
  });

  it('leaves an entry that names none of them, rather than reading its nulls as a reference that is gone', async () => {
    // The trap this guards: a sweep that collects the ids of what it is about and
    // deletes by them catches every document whose reference is null along with
    // the ones whose reference is dangling.
    await db.entries.create([anEntry('a-note', OLD, { authorId: 'somebody', source: 'human', kind: 'note', values: { kind: 'note' } })]);

    const result = await cleanup.run(NOW);

    expect(result.deletedEntries).toBe(0);
    expect(await remainingEntries()).toEqual(['a-note']);
  });
});

describe('pictures nothing points at', () => {
  it('deletes the stills of a camera that is gone, with their bytes', async () => {
    await db.cameras.create({ id: 'kept-camera', ownerId: 'owner', kind: 'rtsp', name: 'The cam' });
    await db.media.create([
      aPicture('kept', OLD, { cameraId: 'kept-camera' }),
      aPicture('collectable', OLD, { cameraId: 'gone-camera' }),
      aPicture('too-recent', RECENT, { cameraId: 'gone-camera' }),
    ]);
    for (const mediaId of ['kept', 'collectable', 'too-recent']) {
      await storeBytes(mediaId, OLD);
    }

    const result = await cleanup.run(NOW);

    expect(result.deletedMedia).toBe(1);
    expect(await remainingMedia()).toEqual(['kept', 'too-recent']);
    // The delete hook on the schema drops the payload of a document it removes,
    // so the orphan sweep in the same run finds nothing left to do.
    expect(await storedFileIds()).toEqual(['kept', 'too-recent']);
    expect(result.deletedOrphanedFiles).toBe(0);
  });

  it('keeps a picture a diary entry, a grow or an account still names', async () => {
    await db.entries.create(anEntry('an-entry', OLD, { mediaIds: ['in-an-entry'] }));
    await db.grows.create(aGrow('a-grow', { coverMediaId: 'a-cover', filmMediaId: 'a-film' }));
    await users.create({ id: 'somebody', email: 'somebody@example.com', passwordHash: 'x', handle: 'somebody', avatarMediaId: 'an-avatar' });
    await db.media.create([
      aPicture('in-an-entry', OLD, { kind: 'photo' }),
      aPicture('a-cover', OLD, { kind: 'photo' }),
      // A whole-grow render belongs to no camera at all.
      aPicture('a-film', OLD, { kind: 'timelapse' }),
      aPicture('an-avatar', OLD, { kind: 'avatar' }),
      aPicture('unreferenced', OLD, { kind: 'photo' }),
      aPicture('just-uploaded', RECENT, { kind: 'photo' }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedMedia).toBe(1);
    expect(await remainingMedia()).toEqual(['a-cover', 'a-film', 'an-avatar', 'in-an-entry', 'just-uploaded']);
  });

  it('keeps a picture of a grow or a space that is still there', async () => {
    await db.spaces.create({ id: 'a-space', ownerId: 'owner', kind: 'tent', name: 'The tent' });
    await db.grows.create(aGrow('a-grow'));
    await db.media.create([
      aPicture('of-a-grow', OLD, { kind: 'photo', growId: 'a-grow' }),
      aPicture('of-a-space', OLD, { kind: 'photo', spaceId: 'a-space' }),
      aPicture('of-a-grow-that-went', OLD, { kind: 'photo', growId: 'gone-grow' }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedMedia).toBe(1);
    expect(await remainingMedia()).toEqual(['of-a-grow', 'of-a-space']);
  });
});

describe('what the migration carried over, while the way back is still open', () => {
  /** The old pictures table, exactly as the migration leaves it standing. */
  const oldPicturesTable = (imageIds: string[]) =>
    db.connection.db!.collection('legacy_images').insertMany(imageIds.map(id => ({ image_id: id, device_id: 'a-device', format: 'jpeg' })));

  it('keeps a picture that arrived with no camera, no grow and no space', async () => {
    // How a picture of a device whose row was already gone comes across: the
    // step writes it with every anchor null and counts it, so a clean,
    // reject-free migration hands the sweep a row it reads as rubbish.
    await oldPicturesTable(['carried-over']);
    await db.media.create([aPicture('carried-over', OLD, { kind: 'photo' }), aPicture('written-since', OLD, { kind: 'photo' })]);
    for (const mediaId of ['carried-over', 'written-since']) await storeBytes(mediaId, OLD);

    const result = await cleanup.run(NOW);

    expect(result.deletedMedia).toBe(1);
    expect(await remainingMedia()).toEqual(['carried-over']);
    expect(await storedFileIds()).toEqual(['carried-over']);
  });

  it('keeps the bytes of a picture the migration had to drop, which have no row naming them', async () => {
    // The first migration moved these bytes out of the document, so the bucket
    // is the only copy and the rollback deliberately does not move them back.
    await oldPicturesTable(['dropped-by-the-migration']);
    await storeBytes('dropped-by-the-migration', OLD);
    await storeBytes('a-real-orphan', OLD);

    const result = await cleanup.run(NOW);

    expect(result.deletedOrphanedFiles).toBe(1);
    expect(await storedFileIds()).toEqual(['dropped-by-the-migration']);
  });

  it('collects both once the way back has been dropped', async () => {
    await db.media.create(aPicture('carried-over', OLD, { kind: 'photo' }));
    await storeBytes('carried-over', OLD);
    await storeBytes('dropped-by-the-migration', OLD);

    const result = await cleanup.run(NOW);

    expect(result.deletedMedia).toBe(1);
    expect(result.deletedOrphanedFiles).toBe(1);
    expect(await storedFileIds()).toEqual([]);
  });
});

describe('stored bytes no document names', () => {
  it('deletes the old orphans and keeps the rest', async () => {
    await db.cameras.create({ id: 'a-camera', ownerId: 'owner', kind: 'rtsp', name: 'The cam' });
    await db.media.create(aPicture('has-a-document', OLD, { cameraId: 'a-camera' }));
    await storeBytes('has-a-document', OLD);
    await storeBytes('orphan', OLD);
    // Still inside the grace period: the document that will point at it may be
    // on its way, which is what the grace period is there for.
    await storeBytes('in-flight', RECENT);

    const result = await cleanup.run(NOW);

    expect(result.deletedOrphanedFiles).toBe(1);
    expect(await storedFileIds()).toEqual(['has-a-document', 'in-flight']);
  });
});
