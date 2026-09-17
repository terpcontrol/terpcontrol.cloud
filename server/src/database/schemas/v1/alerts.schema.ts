import { Schema } from 'mongoose';
import type { Alert } from '@fg2/shared-types/v1';
import { alertKind, severity } from '@fg2/shared-types/v1-schemas';

/**
 * One document from trigger to resolution, which is what the alerts inbox
 * shows: an open alert is one with `resolvedAt: null`.
 *
 * The four references are `null` where they do not apply and never absent. A
 * sweep that deletes the alerts of gone devices does so by `$in` over a list of
 * ids, and a `$in` carrying a null would otherwise take every alert that names
 * no device with it.
 */
export interface StoredAlert extends Omit<Alert, 'createdAt' | 'startedAt' | 'resolvedAt'> {
  createdAt: Date;
  startedAt: Date;
  resolvedAt: Date | null;
}

export const alertsSchema = new Schema<StoredAlert>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    // null for an alert the health loop raised without a rule.
    ruleId: { type: String, default: null },
    deviceId: { type: String, default: null },
    cameraId: { type: String, default: null },
    spaceId: { type: String, default: null },
    kind: { type: String, enum: alertKind.options, required: true },
    severity: { type: String, enum: severity.options, required: true },
    startedAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    value: { type: Number, default: null },
    extremeValue: { type: Number, default: null },
  },
  { collection: 'alerts', versionKey: false },
);

// The open alerts of the spaces a person can see, newest first: the home cards
// and the inbox both ask for exactly this.
alertsSchema.index({ spaceId: 1, resolvedAt: 1, startedAt: -1 });
// One rule's history, and what the engine reopens or resolves against.
alertsSchema.index({ ruleId: 1, startedAt: -1 });
// A device's own alerts, which is also how they are swept when it is given up.
alertsSchema.index({ deviceId: 1, startedAt: -1 });
// A camera that stopped delivering stills has its alert raised and resolved by id.
alertsSchema.index({ cameraId: 1, resolvedAt: 1 });
