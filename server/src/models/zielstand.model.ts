import { model, Schema, Document } from 'mongoose';
import { ZielStand } from '@fg2/shared-types';

const zielStandSchema: Schema = new Schema({
  zelt_id: {
    type: String,
    required: true,
    index: true,
  },
  // A hand target belongs to the tent, not to hardware: the tent with no device
  // sets targets too, and that is what keeps the line continuous across a claim.
  geraet_id: {
    type: String,
    required: false,
  },
  schluessel: {
    type: String,
    required: true,
  },
  // A setpoint is a number for temperature and a string for a workmode, and the
  // collection carries both in one series.
  wert: {
    type: Schema.Types.Mixed,
    required: true,
  },
  gilt_ab: {
    type: Number,
    required: true,
  },
  // Half-open: absent means the value is still in force.
  gilt_bis: {
    type: Number,
    required: false,
  },
  gesetzt_von: {
    type: String,
    required: false,
  },
  quelle: {
    type: String,
    enum: ['app', 'geraet', 'erstbefund', 'hand'],
    required: true,
  },
});

// Every read is "what was in force in this window, newest first", so that is
// the index rather than one per field.
zielStandSchema.index({ zelt_id: 1, gilt_ab: -1 });

const zielStandModel = model<ZielStand & Document>('ZielStand', zielStandSchema);

export default zielStandModel;
