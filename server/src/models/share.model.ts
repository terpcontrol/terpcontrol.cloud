import { model, Schema, Document } from 'mongoose';
import { ShareLink } from '@fg2/shared-types';

const shareSchema: Schema = new Schema({
  share_id: {
    type: String,
    required: true,
    unique: true,
  },
  device_id: {
    type: String,
    required: true,
    index: true,
  },
  owner_id: {
    type: String,
    required: true,
    index: true,
  },
  page: {
    type: String,
    enum: ['charts', 'diary'],
    required: true,
  },
  editable: {
    type: Boolean,
    required: true,
  },
  webcam: {
    type: Boolean,
    required: true,
  },
  query: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Number,
    required: true,
  },
  expiresAt: {
    type: Number,
    required: false,
    default: null,
  },
  revokedAt: {
    type: Number,
    required: false,
    default: null,
  },
  openCount: {
    type: Number,
    required: true,
    default: 0,
  },
  lastOpenedAt: {
    type: Number,
    required: false,
    default: null,
  },
});

const shareModel = model<ShareLink & Document>('Share', shareSchema);

export default shareModel;
