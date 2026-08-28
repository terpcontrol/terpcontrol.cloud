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
  // Empty until somebody names the tent: a display name is a user-facing
  // decision and no server-side default can be written in the user's language.
  name: {
    type: String,
    required: false,
    default: '',
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
  // The device binding a migrated tent stands for. Unique, so two instances
  // deriving tents for the same device at once collide instead of both writing.
  migriert_aus: {
    type: String,
    required: false,
    unique: true,
    sparse: true,
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
