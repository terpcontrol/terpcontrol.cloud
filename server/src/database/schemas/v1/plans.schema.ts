import { Schema } from 'mongoose';
import type { Plan, PlanNotify, PlanState, PlanStep, StepDuration } from '@fg2/shared-types/v1';
import { durationUnit, growthStage, planNotifyMode, planStatus } from '@fg2/shared-types/v1-schemas';

/** The plan a device is currently being run by: one per device, with where it stands in `state`. */
export interface StoredPlanState extends Omit<
  PlanState,
  'stepStartedAt' | 'lastAppliedAt' | 'confirmationNotifiedAt' | 'confirmationAskedAt' | 'confirmationAskTriedAt'
> {
  stepStartedAt: Date | null;
  lastAppliedAt: Date | null;
  confirmationNotifiedAt: Date | null;
  confirmationAskedAt: Date | null;
  confirmationAskTriedAt: Date | null;
}

export interface StoredPlan extends Omit<Plan, 'createdAt' | 'state'> {
  createdAt: Date;
  state: StoredPlanState;
}

const durationSchema = new Schema<StepDuration>(
  {
    value: { type: Number, required: true },
    unit: { type: String, enum: durationUnit.options, required: true },
  },
  { _id: false, versionKey: false },
);

/**
 * A step of a plan, shared with `planTemplates`: a template is a plan that runs
 * nothing, and its steps are the same steps.
 *
 * `id` is the step's own and stays across edits, so a running step survives
 * another being inserted above it; mongoose's `_id` is bookkeeping and is off.
 */
export const planStepSchema = new Schema<PlanStep>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    stage: { type: String, enum: growthStage.options, default: null },
    preset: { type: String, default: null },
    duration: { type: durationSchema, required: true },
    // A fragment of the device's own configuration document, as untyped here as
    // that document is.
    settings: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    waitForConfirmation: { type: Boolean, required: true, default: false },
    confirmationMessage: { type: String, default: null },
  },
  { _id: false, versionKey: false, minimize: false },
);

const notifySchema = new Schema<PlanNotify>(
  {
    mode: { type: String, enum: planNotifyMode.options, required: true, default: 'off' },
    // null writes to the owner's address.
    email: { type: String, default: null },
    writeEntries: { type: Boolean, required: true, default: true },
  },
  { _id: false, versionKey: false },
);

const stateSchema = new Schema<StoredPlanState>(
  {
    status: { type: String, enum: planStatus.options, required: true, default: 'stopped' },
    activeStepIndex: { type: Number, required: true, default: 0 },
    stepStartedAt: { type: Date, default: null },
    // What the step had already served when it was paused; it resumes there
    // rather than starting over.
    pausedElapsedMs: { type: Number, required: true, default: 0 },
    pauseReason: { type: String, default: null },
    lastAppliedAt: { type: Date, default: null },
    // The plan's own mail about a waiting step, and the ask that goes to the
    // people who keep the tent, are two different things and are written down
    // separately: the ask is re-attempted until it has actually reached them.
    confirmationNotifiedAt: { type: Date, default: null },
    confirmationAskedAt: { type: Date, default: null },
    confirmationAskTriedAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false },
);

export const plansSchema = new Schema<StoredPlan>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    deviceId: { type: String, required: true, unique: true },
    templateId: { type: String, default: null },
    name: { type: String, required: true },
    steps: { type: [planStepSchema], required: true, default: () => [] },
    loop: { type: Boolean, required: true, default: false },
    notify: { type: notifySchema, required: true, default: () => ({}) },
    state: { type: stateSchema, required: true, default: () => ({}) },
  },
  // A step's settings are a configuration fragment, and an empty one is a step
  // that changes nothing rather than a step without settings.
  { collection: 'plans', versionKey: false, minimize: false },
);

// The engine's tick and its hourly re-apply walk the running plans, which are a
// handful of the rows.
plansSchema.index({ 'state.status': 1 });
