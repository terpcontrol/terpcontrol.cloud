import { model, Schema, Document } from 'mongoose';
import { Zugangsschluessel } from '@interfaces/schluessel.interface';
import { baueIndexe } from '@utils/indexe';

const zugangsschluesselSchema: Schema = new Schema({
  // One key per Zelt: minting again rotates the old one out rather than
  // leaving two working keys behind, and unique is what enforces that.
  zelt_id: {
    type: String,
    required: true,
    unique: true,
  },
  hash: {
    type: String,
    required: true,
    index: true,
  },
  erstellt_at: {
    type: Number,
    required: true,
  },
  zuletzt_at: {
    type: Number,
    required: false,
  },
});

const zugangsschluesselModel = model<Zugangsschluessel & Document>('Zugangsschluessel', zugangsschluesselSchema);
baueIndexe(zugangsschluesselModel);

export default zugangsschluesselModel;
