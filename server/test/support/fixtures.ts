import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
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

/** Stores a webcam still for a device, as the RTSP poller would have. */
export const storeWebcamStill = (deviceId: string, data: Buffer, timestamp: number): Promise<StoredStill> =>
  withDatabase(async database => {
    const imageId = randomUUID();

    await database.collection('images').insertOne({
      image_id: imageId,
      device_id: deviceId,
      format: 'jpeg',
      timestamp,
      data,
    });

    return { imageId };
  });
