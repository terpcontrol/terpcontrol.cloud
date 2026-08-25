import { model, Schema, Document } from 'mongoose';
import { Ding } from '@fg2/shared-types';

const dingSchema: Schema = new Schema({
  // Minted by the client so a retry over a bad connection upserts instead of
  // logging the same watering twice; unique is what makes that safe.
  ding_id: {
    type: String,
    required: true,
    unique: true,
  },
  zelt_id: {
    type: String,
    required: true,
  },
  art: {
    type: String,
    required: true,
  },
  // A Zeile carries its own text - a Notiz has no title and a Gabe is named by
  // what it is - so an empty name is normal, and mongoose reads `required` as
  // "not the empty string". The default keeps the field present either way.
  name: {
    type: String,
    required: false,
    default: '',
  },
  t: {
    type: Number,
    required: true,
  },
  // Three states, not two: a number, an explicit null for an interval that is
  // still open, and absent for a Ding that is not an interval at all. No
  // default, because a default would collapse the last two.
  t_ende: {
    type: Number,
    required: false,
  },
  erfasst_at: {
    type: Number,
    required: false,
  },
  // Free-form on purpose: the edge names and the per-art payload are contract
  // between client and server (`DingDaten`), validated in `ding-validierung`
  // rather than by a schema that would have to be migrated per art.
  rel: {
    type: Schema.Types.Mixed,
    required: false,
  },
  d: {
    type: Schema.Types.Mixed,
    required: false,
  },
  // Without `default: undefined` mongoose would give every Ding an empty array,
  // and a reader could no longer tell "no photos" from "photos not authored".
  bilder: {
    type: [String],
    required: false,
    default: undefined,
  },
  auto_bild: {
    type: String,
    required: false,
  },
  akteur: {
    type: String,
    required: false,
  },
  storniert_von: {
    type: String,
    required: false,
  },
});

// `geraet_id` is deliberately not a path here: it belongs to a projected Ding,
// never to a stored one. Strict mode drops it, and the validator refuses it
// outright so a client that sends one is told rather than silently corrected.

// The list read: one tent, newest first.
dingSchema.index({ zelt_id: 1, t: -1 });
// The same read filtered to one art, which is how every Tafel section loads.
dingSchema.index({ zelt_id: 1, art: 1, t: -1 });

const dingModel = model<Ding & Document>('Ding', dingSchema);

export default dingModel;
