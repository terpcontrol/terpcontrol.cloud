import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { context } from './api';

/**
 * A few things the API cannot make, because only the server's own pollers or an
 * operator's shell do - a webcam still at a chosen age, a device in the public
 * demo. The assertions still go through HTTP; this only puts the state there.
 */
const withDatabase = async <T>(use: (database: import('mongodb').Db) => Promise<T>): Promise<T> => {
  const client = new MongoClient(context.mongoUri);
  try {
    await client.connect();
    return await use(client.db('terpcontrol_test'));
  } finally {
    await client.close();
  }
};

export interface StoredStill {
  imageId: string;
}

/**
 * Puts a device into the public demo. There is no API for it - an operator sets
 * the flag by hand, which is what `./simulate-device.sh demo on` does too, and
 * it marks what hangs off the device with it: a demo session reads every object
 * that carries the flag, so the space it stands in and its cameras carry it too.
 */
export const markAsDemoDevice = (deviceId: string, demo = true): Promise<void> =>
  withDatabase(async database => {
    const device = await database.collection('devices').findOne({ id: deviceId });
    if (!device) throw new Error(`No device ${deviceId} to put into the demo`);

    await database.collection('devices').updateOne({ id: deviceId }, { $set: { isDemo: demo } });
    if (device.spaceId) await database.collection('spaces').updateOne({ id: device.spaceId }, { $set: { isDemo: demo } });
    await database.collection('cameras').updateMany({ deviceId }, { $set: { isDemo: demo } });
  });

/**
 * The diary entries of one device. The timeline has no read route yet - it
 * arrives with the logging slice - and two things here are only visible in what
 * a device's line became, so they are read from the collection meanwhile.
 */
export const diaryEntriesOf = (deviceId: string): Promise<Record<string, unknown>[]> =>
  withDatabase(database => database.collection('entries').find({ deviceId }).sort({ createdAt: 1 }).toArray());

/** The GridFS bucket the pictures are kept in, beside the collection indexing them. */
const BUCKET_NAME = 'imagedata';

/** Whether the bytes of a picture are in the image store, which is where they live. */
export const storedImageExists = (imageId: string): Promise<boolean> =>
  withDatabase(async database => (await database.collection(`${BUCKET_NAME}.files`).countDocuments({ _id: imageId as never })) > 0);

/**
 * Stores a webcam still for a device, as the RTSP poller would have: the bytes
 * in the image store under the id the document names, and the size the document
 * serves a Content-Length from.
 */
export const storeWebcamStill = (deviceId: string, data: Buffer, timestamp: number): Promise<StoredStill> =>
  withDatabase(async database => {
    const imageId = randomUUID();

    // A stored file carries the image_id as its `_id`, where the driver's types
    // expect an ObjectId - the server writes it the same way.
    await pipeline(
      Readable.from(data),
      new GridFSBucket(database, { bucketName: BUCKET_NAME }).openUploadStreamWithId(imageId as unknown as ObjectId, imageId),
    );

    await database.collection('images').insertOne({
      image_id: imageId,
      device_id: deviceId,
      format: 'jpeg',
      timestamp,
      size: data.length,
    });

    return { imageId };
  });

/**
 * A read-only share link on a grow. Making one is the sharing round's route; a
 * link is inserted here because what it may and may not do is decided now.
 */
export const shareLinkOnGrow = (growId: string, token: string): Promise<void> =>
  withDatabase(async database => {
    await database.collection('shareLinks').insertOne({
      id: randomUUID(),
      createdAt: new Date(),
      token,
      kind: 'view',
      subject: { type: 'grow', id: growId },
      range: { startsAt: null, endsAt: null },
      includeCameras: true,
      createdBy: null,
      expiresAt: null,
      revokedAt: null,
      state: { openCount: 0, lastOpenedAt: null },
    });
  });

/**
 * A reminder on a space, which is what a derived task comes from. Reminders
 * have no routes yet - they arrive with the notifications round - and a spec
 * that needs a tent with something due cannot wait for them.
 */
export const remindSpace = (spaceId: string, createdBy: string, label = 'Water the tent'): Promise<string> =>
  withDatabase(async database => {
    const id = randomUUID();

    await database.collection('reminders').insertOne({
      id,
      createdAt: new Date(),
      subject: { type: 'space', id: spaceId },
      kind: 'water',
      label,
      everyDays: 1,
      onceAt: null,
      assigneeId: null,
      defaults: null,
      createdBy,
    });

    return id;
  });

/**
 * A still of a camera, as the poller would have stored it: the bytes in the
 * bucket under the id the row names. The poller only runs against a camera it
 * can reach, and a spec that needs a picture to exist at a chosen moment needs
 * one that no stream has to answer for.
 */
export const storeCameraStill = (cameraId: string, data: Buffer, capturedAt: Date): Promise<string> =>
  withDatabase(async database => {
    const id = randomUUID();

    await pipeline(
      Readable.from(data),
      new GridFSBucket(database, { bucketName: BUCKET_NAME }).openUploadStreamWithId(id as unknown as ObjectId, id),
    );

    await database.collection('media').insertOne({
      id,
      createdAt: new Date(),
      kind: 'still',
      mime: 'image/jpeg',
      bytes: data.length,
      cameraId,
      growId: null,
      spaceId: null,
      uploadedBy: null,
      capturedAt,
      endsAt: null,
      window: null,
      quality: null,
      lengthSeconds: null,
      render: null,
    });

    return id;
  });

/**
 * A row in a collection that has no routes yet. Five of them - the chart views,
 * the feeding schemes, the plan templates, the push subscriptions and the
 * notification log - are registered, indexed and injected nowhere, so a spec
 * about what an account leaves behind can neither put one there nor read it back
 * through the API.
 */
export const seedRow = (collection: string, document: Record<string, unknown>): Promise<void> =>
  withDatabase(async database => {
    await database.collection(collection).insertOne({ ...document });
  });

/** What is in a collection, for asserting that something is really gone rather than only unlisted. */
export const rowsIn = (collection: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> =>
  withDatabase(database => database.collection(collection).find(filter).toArray());

/**
 * Somebody let into a space. There are no membership routes yet - they arrive
 * with the sharing round - and what a member may do to the space owner's things
 * is decided now.
 */
export const joinSpace = (spaceId: string, userId: string, role: 'can_log' | 'can_manage' = 'can_log'): Promise<void> =>
  seedRow('memberships', { id: randomUUID(), spaceId, userId, role, invitedBy: null, inviteId: null, createdAt: new Date() });

/**
 * An account whose deletion began and then stopped: the marker set and the
 * sessions gone, which is exactly what a run killed after its first step leaves
 * behind. What picks it up again is either route, or the sweep at boot.
 */
export const beginDeletionOf = (userId: string): Promise<void> =>
  withDatabase(async database => {
    await database.collection('users').updateOne({ id: userId }, { $set: { deletionStartedAt: new Date() } });
    await database.collection('sessions').deleteMany({ userId });
  });
