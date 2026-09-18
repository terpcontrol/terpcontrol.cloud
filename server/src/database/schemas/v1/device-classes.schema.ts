import { Schema } from 'mongoose';
import type { DeviceClass, DeviceClassFirmwareIds, DeviceClassRollout } from '@fg2/shared-types/v1';

/** The update class of a hardware type: which build each channel points at, and how fast it is handed out. */
export interface StoredDeviceClass extends Omit<DeviceClass, 'createdAt'> {
  createdAt: Date;
}

const firmwareIdsSchema = new Schema<DeviceClassFirmwareIds>(
  {
    stable: { type: String, default: null },
    beta: { type: String, default: null },
    alpha: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

const rolloutSchema = new Schema<DeviceClassRollout>(
  {
    paused: { type: Boolean, required: true, default: false },
    // A class that is not being staged reaches all of itself.
    percent: { type: Number, required: true, default: 100, min: 0, max: 100 },
  },
  { _id: false, versionKey: false },
);

export const deviceClassesSchema = new Schema<StoredDeviceClass>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    name: { type: String, required: true },
    description: { type: String, default: null },
    concurrentUpdates: { type: Number, required: true },
    maxFailures: { type: Number, required: true },
    firmwareIds: { type: firmwareIdsSchema, required: true, default: () => ({}) },
    rollout: { type: rolloutSchema, required: true, default: () => ({}) },
  },
  { collection: 'deviceClasses', versionKey: false },
);
