import { Schema } from 'mongoose';
import { plantStatus } from '@fg2/shared-types/v1-schemas';
import type { Plant, PlantHarvest } from '@fg2/shared-types/v1';

type PlantHarvestDocument = Omit<PlantHarvest, 'harvestedAt'> & { harvestedAt: Date };

/**
 * One plant, one document, so that a phase, a placement or a split harvest can
 * name exactly these plants and a count is simply how many rows there are.
 * Weights live here and are stripped from every view but the owner's and a
 * member's.
 */
export type PlantDocument = Omit<Plant, 'harvest' | 'createdAt'> & {
  harvest: PlantHarvestDocument | null;
  createdAt: Date;
};

const harvestSchema = new Schema<PlantHarvestDocument>(
  {
    harvestedAt: { type: Date, required: true },
    wetWeightG: { type: Number, default: null },
    dryWeightG: { type: Number, default: null },
  },
  { _id: false },
);

export const plantsSchema = new Schema<PlantDocument>(
  {
    id: { type: String, required: true, unique: true },
    growId: { type: String, required: true, index: true },
    strain: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: plantStatus.options, required: true, default: 'active' },
    harvest: { type: harvestSchema, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'plants', versionKey: false },
);
