import { Schema } from 'mongoose';
import { PasswordToken } from '@fg2/shared-types';

export const passwordTokenSchema: Schema = new Schema({
  user_id: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    required: true,
    default: () => {
      return Date.now();
    },
  },
});
