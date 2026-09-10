import { Schema } from 'mongoose';
import { DeviceFirmware, DeviceFirmwareBinary } from '@fg2/shared-types';

export const deviceFirmwareSchema: Schema = new Schema({
  firmware_id: {
    type: String,
    required: true,
    unique: true,
  },
  class_id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: false,
  },
  version: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Number,
    required: false,
    default: () => Date.now(),
  },
  wasStable: {
    type: Boolean,
    required: false,
    default: false,
  },
});

export const deviceFirmwareBinarySchema: Schema = new Schema({
  firmware_id: {
    type: String,
    required: true,
    unique: false,
  },
  name: {
    type: String,
    required: false,
  },
  data: {
    type: Buffer,
    required: true,
  },
});
