import { Schema } from 'mongoose';
import type { PhaseTargets } from '@fg2/shared-types/v1';
import { phaseTargetsSchema } from './grows.schema';

/**
 * What a device's configuration aimed at from an instant on: one row each time
 * the targets in it moved, whoever moved them - a person saving the targets, a
 * plan stepping, a preset, the device's own menu.
 *
 * The store keeps readings and never setpoints, and the configuration only says
 * what is being aimed at now, so this is the one place the past of a target
 * band can be read from. A row holds until the next row of the same device;
 * `targets` is null where the configuration stated none.
 */
export interface StoredTargetChange {
  id: string;
  deviceId: string;
  at: Date;
  targets: PhaseTargets | null;
}

export const targetChangesSchema = new Schema<StoredTargetChange>(
  {
    id: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    at: { type: Date, required: true },
    targets: { type: phaseTargetsSchema, default: null },
  },
  { collection: 'targetChanges', versionKey: false },
);

// A window of one device's targets: the row standing at its start and the
// rows inside it.
targetChangesSchema.index({ deviceId: 1, at: -1 });
