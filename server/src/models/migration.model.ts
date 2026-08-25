import { model, Schema, Document } from 'mongoose';

export interface MigrationLock {
  name: string;
  /** Epoch ms the current run started; null when no run is in flight. */
  laeuft_seit?: number | null;
  beendet_at?: number | null;
  /** Identifies the run holding the lock, so only that run can release it. */
  run_id?: string | null;
}

const migrationSchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  laeuft_seit: {
    type: Number,
    required: false,
    default: null,
  },
  beendet_at: {
    type: Number,
    required: false,
    default: null,
  },
  run_id: {
    type: String,
    required: false,
    default: null,
  },
});

const migrationModel = model<MigrationLock & Document>('Migration', migrationSchema);

export default migrationModel;
