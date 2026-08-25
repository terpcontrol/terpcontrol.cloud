import { model, Schema, Document } from 'mongoose';
import { Ding } from '@fg2/shared-types';
import { baueIndexe } from '@utils/indexe';

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
  // When this was typed, as against `t`, which is when it happened. The default
  // lives here rather than in a controller so it cannot be forgotten by one
  // write path and so a client cannot backdate it. With an insert-only upsert
  // it also stays stable across a retry, which is what makes it mean anything.
  erfasst_at: {
    type: Number,
    required: false,
    default: () => Date.now(),
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
// The unique `ding_id` is what makes the upsert safe: without the index, two
// simultaneous retries of the same watering both insert, and the promise that
// a retry cannot double-log is not kept. The collection is new and empty, so
// building the indexes on import costs nothing.
baueIndexe(dingModel);

export default dingModel;
