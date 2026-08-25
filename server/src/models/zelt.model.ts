import { model, Schema, Document } from 'mongoose';
import { Zelt } from '@fg2/shared-types';

const zeltSchema: Schema = new Schema({
  zelt_id: {
    type: String,
    required: true,
    unique: true,
  },
  besitzer_id: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  geraete: {
    type: [
      {
        _id: false,
        geraet_id: { type: String, required: true },
        seit: { type: Number, required: true },
        bis: { type: Number, required: false },
      },
    ],
    required: true,
    default: [],
  },
  zeitzone: {
    type: String,
    required: true,
  },
  tag_null: {
    type: Number,
    required: true,
  },
  kamera_leitgeraet: {
    type: String,
    required: false,
  },
  erstellt_at: {
    type: Number,
    required: true,
  },
  // Free-form by design: tent facts are cloud-side and grow over time, and none
  // of them may ever reach the device configuration.
  d: {
    type: Schema.Types.Mixed,
    required: false,
  },
});

// A device belongs to at most one tent at a time; the lookup runs on every
// projection of device data into a tent.
zeltSchema.index({ 'geraete.geraet_id': 1 });

const zeltModel = model<Zelt & Document>('Zelt', zeltSchema);

export default zeltModel;
