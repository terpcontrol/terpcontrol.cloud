import { Schema } from 'mongoose';

export const claimCodeSchema: Schema = new Schema({
  claim_code: {
    type: String,
    required: false,
    unique: true,
  },
  device_id: {
    type: String,
    required: false,
    unique: true,
  },
});
