import { model, Schema, Document } from 'mongoose';
import { Schluessel } from '@interfaces/schluessel.interface';
import { baueIndexe } from '@utils/indexe';

const schluesselSchema: Schema = new Schema({
  schluessel_id: {
    type: String,
    required: true,
    unique: true,
  },
  zelt_id: {
    type: String,
    required: true,
    index: true,
  },
  // Who the key writes as. Every Ding it creates carries this as `akteur`.
  mensch_ding_id: {
    type: String,
    required: true,
  },
  // The lookup on every key-bearing request, so it is the indexed field.
  hash: {
    type: String,
    required: true,
    index: true,
  },
  erstellt_at: {
    type: Number,
    required: true,
  },
  widerrufen_at: {
    type: Number,
    required: false,
    default: null,
  },
  zuletzt_at: {
    type: Number,
    required: false,
  },
});

const schluesselModel = model<Schluessel & Document>('Schluessel', schluesselSchema);
baueIndexe(schluesselModel);

export default schluesselModel;
