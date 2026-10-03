import { Schema } from 'mongoose';
import type { PhaseTargets } from '@fg2/shared-types/v1';
import type { Cycle } from '@fg2/shared-types/v1-schemas/day-night.js';
import { phaseTargetsSchema } from './grows.schema';

/**
 * What a device's configuration aimed at from an instant on: one row each time
 * the targets in it moved, whoever moved them - a person saving the targets, a
 * plan stepping, a preset, the device's own menu - and each time the cycle that
 * decides which half of them holds did: the light schedule, its ramps and the
 * work mode.
 *
 * The store keeps readings and never setpoints, and the configuration only says
 * what is being aimed at now, so this is the one place the past of a target
 * band can be read from - and the past of the nights, which are the schedule's
 * and not the lamp's. A row holds until the next row of the same device;
 * `targets` is null where the configuration stated none, and `cycle` where the
 * device keeps none or the row was written before cycles were recorded.
 */
export interface StoredTargetChange {
  id: string;
  deviceId: string;
  at: Date;
  targets: PhaseTargets | null;
  cycle?: Cycle | null;
}

const cycleSchema = new Schema<Cycle>(
  {
    day: { type: Number, required: true },
    night: { type: Number, required: true },
    workmode: { type: String, default: null },
    sunrise: { type: Number, required: true },
    sunset: { type: Number, required: true },
    glides: { type: Boolean, required: true },
  },
  { _id: false },
);

export const targetChangesSchema = new Schema<StoredTargetChange>(
  {
    id: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    at: { type: Date, required: true },
    targets: { type: phaseTargetsSchema, default: null },
    cycle: { type: cycleSchema, default: null },
  },
  { collection: 'targetChanges', versionKey: false },
);

// A window of one device's targets: the row standing at its start and the
// rows inside it.
targetChangesSchema.index({ deviceId: 1, at: -1 });
