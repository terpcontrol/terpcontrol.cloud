import { Schema } from 'mongoose';
import type { Firmware } from '@fg2/shared-types/v1';

/** One build of one device class. Builds are not ordered: a version is the uuid the build container stamped. */
export interface StoredFirmware extends Omit<Firmware, 'createdAt'> {
  createdAt: Date;
}

export const firmwaresSchema = new Schema<StoredFirmware>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    classId: { type: String, required: true },
    name: { type: String, default: null },
    version: { type: String, required: true },
    // Once true it stays true, so a build can be rolled back to knowingly.
    wasStable: { type: Boolean, required: true, default: false },
  },
  { collection: 'firmwares', versionKey: false },
);

// The builds of one class, newest first: the admin list and what a device is offered.
firmwaresSchema.index({ classId: 1, createdAt: -1 });
// A device and the build CLI name a build by its uuid, which is how one is found again.
firmwaresSchema.index({ version: 1 });
