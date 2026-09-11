import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Document, Model } from 'mongoose';
import { ClaimCode, Device, DeviceClass, DeviceFirmware, DeviceLog, Image } from '@fg2/shared-types';
import { claimCodeSchema } from '@database/schemas/claimcode.schema';
import { deviceSchema } from '@database/schemas/device.schema';
import { deviceClassSchema } from '@database/schemas/deviceclass.schema';
import { deviceFirmwareSchema } from '@database/schemas/devicefirmware.schema';
import { deviceLogSchema } from '@database/schemas/devicelog.schema';
import { imagesSchema } from '@database/schemas/images.schema';
import { MODEL } from '@database/models';

/**
 * A real MongoDB for the specs that exercise a service's queries. Those are
 * where the behaviour lives - a `$regex`, a `distinct`, a cursor over a GridFS
 * bucket - and a stubbed model would only ever confirm that the spec and the
 * service agree on what to stub.
 */
export interface TestDatabase {
  connection: Connection;
  devices: Model<Device & Document>;
  deviceClasses: Model<DeviceClass & Document>;
  deviceFirmwares: Model<DeviceFirmware & Document>;
  claimCodes: Model<ClaimCode & Document>;
  deviceLogs: Model<DeviceLog & Document>;
  images: Model<Image & Document>;
  /** Empty every collection, including the GridFS bucket. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const startTestDatabase = async (): Promise<TestDatabase> => {
  const server = await MongoMemoryServer.create();
  const connection = mongoose.createConnection(server.getUri('unit-spec'));
  await connection.asPromise();

  const devices = connection.model<Device & Document>(MODEL.device, deviceSchema);
  const deviceClasses = connection.model<DeviceClass & Document>(MODEL.deviceClass, deviceClassSchema);
  const deviceFirmwares = connection.model<DeviceFirmware & Document>(MODEL.deviceFirmware, deviceFirmwareSchema);
  const claimCodes = connection.model<ClaimCode & Document>(MODEL.claimCode, claimCodeSchema);
  const deviceLogs = connection.model<DeviceLog & Document>(MODEL.deviceLog, deviceLogSchema);
  const images = connection.model<Image & Document>(MODEL.image, imagesSchema);

  return {
    connection,
    devices,
    deviceClasses,
    deviceFirmwares,
    claimCodes,
    deviceLogs,
    images,
    reset: async () => {
      const collections = await connection.db.collections();
      await Promise.all(collections.map(collection => collection.deleteMany({})));
    },
    stop: async () => {
      await connection.close();
      await server.stop();
    },
  };
};
