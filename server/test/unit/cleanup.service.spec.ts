import { ObjectId } from 'mongodb';
import { ImageStore } from '@database/image-store';
import { CleanupService } from '@modules/cleanup/cleanup.service';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * The daily sweep has no HTTP surface of its own, so the black-box suite cannot
 * reach it: `run` is called here directly, against a real database, with `now`
 * chosen per case so the seven-day grace period can be crossed without waiting.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 20);
/** Past the grace period, so a record that is unreachable is also collectable. */
const OLD = NOW - 30 * DAY_MS;
/** Unreachable, but too recent to collect. */
const RECENT = NOW - 2 * DAY_MS;

let db: TestDatabase;
let store: ImageStore;
let cleanup: CleanupService;

const aDevice = (device_id: string) => ({ device_id, username: device_id, password: 'secret' });

const aLog = (device_id: string, time: number, rest: Record<string, unknown> = {}) => ({
  device_id,
  time: new Date(time),
  severity: 0,
  ...rest,
});

const anImage = (image_id: string, device_id: string, timestamp: number, format = 'jpeg') => ({
  image_id,
  device_id,
  timestamp,
  format,
});

/** Store bytes for a picture and date the file, which is what the sweep reads. */
const storeBytes = async (image_id: string, uploadedAt: number) => {
  await store.upload(image_id, Buffer.from(`bytes of ${image_id}`));
  // A file carries the image_id as its `_id`, where the driver's types expect an
  // ObjectId - the store writes it the same way.
  const fileId = image_id as unknown as ObjectId;
  await db.connection.db.collection('imagedata.files').updateOne({ _id: fileId }, { $set: { uploadDate: new Date(uploadedAt) } });
};

const storedFileIds = async (): Promise<string[]> => {
  const files = await db.connection.db
    .collection('imagedata.files')
    .find({}, { projection: { _id: 1 } })
    .toArray();
  return files.map(file => String(file._id)).sort();
};

beforeAll(async () => {
  db = await startTestDatabase();
  store = new ImageStore(db.connection, db.images);
  cleanup = new CleanupService(db.devices, db.deviceLogs, db.images, store);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(() => db.reset());

describe('logs of removed devices', () => {
  it('deletes the old ones and keeps everything still reachable', async () => {
    await db.devices.create(aDevice('kept-device'));
    await db.deviceLogs.create([
      aLog('kept-device', OLD, { message: 'still owned' }),
      aLog('gone-device', OLD, { message: 'collectable' }),
      aLog('gone-device', RECENT, { message: 'inside the grace period' }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedLogs).toBe(1);
    expect((await db.deviceLogs.find().lean()).map(log => log.message).sort()).toEqual(['inside the grace period', 'still owned']);
  });
});

describe('camera capture diagnostics', () => {
  it('deletes the successful ones whatever their age, and keeps the failures', async () => {
    await db.devices.create(aDevice('cam-device'));
    await db.deviceLogs.create([
      aLog('cam-device', NOW, { message: 'message-cam-capture:ok 42ms' }),
      aLog('cam-device', OLD, { message: 'message-cam-capture:ok 51ms' }),
      aLog('cam-device', NOW, { message: 'message-cam-capture:failed timeout' }),
      aLog('cam-device', NOW, { message: 'not-message-cam-capture:ok' }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedCamDiagnostics).toBe(2);
    expect((await db.deviceLogs.find().lean()).map(log => log.message).sort()).toEqual([
      'message-cam-capture:failed timeout',
      'not-message-cam-capture:ok',
    ]);
  });
});

describe('images of removed devices', () => {
  it('deletes the old ones, with their bytes, and keeps everything still reachable', async () => {
    await db.devices.create(aDevice('kept-device'));
    await db.images.create([
      anImage('kept', 'kept-device', OLD),
      anImage('collectable', 'gone-device', OLD),
      anImage('too-recent', 'gone-device', RECENT),
    ]);
    for (const imageId of ['kept', 'collectable', 'too-recent']) {
      await storeBytes(imageId, OLD);
    }

    const result = await cleanup.run(NOW);

    expect(result.deletedImages).toBe(1);
    expect((await db.images.find().lean()).map(image => image.image_id).sort()).toEqual(['kept', 'too-recent']);
    // The delete hook on the schema drops the payload of a document it removes,
    // so the orphan sweep in the same run finds nothing left to do.
    expect(await storedFileIds()).toEqual(['kept', 'too-recent']);
    expect(result.deletedOrphanedFiles).toBe(0);
  });
});

describe('user pictures', () => {
  it('deletes the ones no diary entry lists any more', async () => {
    await db.devices.create(aDevice('diary-device'));
    await db.images.create([
      anImage('referenced', 'diary-device', OLD, 'user/jpeg'),
      anImage('in-a-deleted-entry', 'diary-device', OLD + 1, 'user/jpeg'),
      anImage('unreferenced', 'diary-device', OLD + 2, 'user/jpeg'),
      anImage('just-uploaded', 'diary-device', RECENT, 'user/jpeg'),
    ]);
    await db.deviceLogs.create([
      aLog('diary-device', NOW, { message: 'an entry', images: ['referenced'] }),
      // Soft-deleted, and the owner can still restore it, so its picture is
      // still reachable.
      aLog('diary-device', NOW, { message: 'a deleted entry', images: ['in-a-deleted-entry'], deleted: true }),
    ]);

    const result = await cleanup.run(NOW);

    expect(result.deletedImages).toBe(1);
    expect((await db.images.find().lean()).map(image => image.image_id).sort()).toEqual(['in-a-deleted-entry', 'just-uploaded', 'referenced']);
  });

  it('leaves a device its stills and timelapses', async () => {
    await db.devices.create(aDevice('cam-device'));
    await db.images.create([anImage('a-still', 'cam-device', OLD), anImage('a-timelapse', 'cam-device', OLD, 'mp4')]);

    const result = await cleanup.run(NOW);

    expect(result.deletedImages).toBe(0);
    expect(await db.images.countDocuments()).toBe(2);
  });
});

describe('stored bytes no document names', () => {
  it('deletes the old orphans and keeps the rest', async () => {
    await db.devices.create(aDevice('cam-device'));
    await db.images.create(anImage('has-a-document', 'cam-device', OLD));
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
