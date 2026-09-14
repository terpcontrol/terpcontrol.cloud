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
 * the flag by hand, which is what `./simulate-device.sh demo on` does too.
 */
export const markAsDemoDevice = (deviceId: string, demo = true): Promise<void> =>
  withDatabase(async database => {
    await database.collection('devices').updateOne({ device_id: deviceId }, { $set: { demoDevice: demo } });
  });

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
