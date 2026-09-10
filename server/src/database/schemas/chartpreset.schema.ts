import { Schema } from 'mongoose';

export const chartPresetSchema: Schema = new Schema({
  preset_id: {
    type: String,
    required: true,
    unique: true,
  },
  owner_id: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  device_type: {
    type: String,
    required: false,
  },
  query: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Number,
    required: true,
  },
});
