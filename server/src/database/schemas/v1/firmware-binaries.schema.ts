import { Schema } from 'mongoose';
import type { FirmwareBinary } from '@fg2/shared-types/v1';

/** One file of a build. The bytes are what OTA streams to a device. */
export interface StoredFirmwareBinary extends Omit<FirmwareBinary, 'createdAt'> {
  createdAt: Date;
}

export const firmwareBinariesSchema = new Schema<StoredFirmwareBinary>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    firmwareId: { type: String, required: true },
    name: { type: String, required: true },
    // A megabyte or two per row, and only the OTA route ever wants them; a
    // listing that dragged them along would read the whole build per line.
    data: { type: Buffer, required: true, select: false },
  },
  { collection: 'firmwareBinaries', versionKey: false },
);

// What OTA asks for: the file of this build by name. One file per name per build.
firmwareBinariesSchema.index({ firmwareId: 1, name: 1 }, { unique: true });
