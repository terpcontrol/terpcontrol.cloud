import { Schema } from 'mongoose';
import type { PlanTemplate } from '@fg2/shared-types/v1';
import { planStepSchema } from './plans.schema';

/** A plan kept to start others from. It runs nothing, so it has no state. */
export interface StoredPlanTemplate extends Omit<PlanTemplate, 'createdAt'> {
  createdAt: Date;
}

export const planTemplatesSchema = new Schema<StoredPlanTemplate>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    ownerId: { type: String, required: true },
    name: { type: String, required: true },
    isPublic: { type: Boolean, required: true, default: false },
    steps: { type: [planStepSchema], required: true, default: () => [] },
  },
  { collection: 'planTemplates', versionKey: false, minimize: false },
);

// A person's own templates, by a name they only have to keep unique to themselves.
planTemplatesSchema.index({ ownerId: 1, name: 1 }, { unique: true });
// The templates anybody may start from, which is the rest of the list everyone sees.
planTemplatesSchema.index({ isPublic: 1 }, { partialFilterExpression: { isPublic: true } });
