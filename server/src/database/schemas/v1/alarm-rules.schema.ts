import { Schema } from 'mongoose';
import type { AlarmDelivery, AlarmDeliveryCustom, AlarmRule, AlarmRuleState, AlarmWebhook } from '@fg2/shared-types/v1';
import { alarmDeliveryChannel, alarmDeliveryMode, alarmOrigin, metric, severity, webhookMethod } from '@fg2/shared-types/v1-schemas';

/**
 * One threshold rule on one device's metric. What the rule says and where the
 * engine has got to are apart: `state` is the server's and no client writes it.
 */
export interface StoredAlarmRuleState extends Omit<AlarmRuleState, 'lastTriggeredAt' | 'lastResolvedAt' | 'lastSampleAt'> {
  lastTriggeredAt: Date | null;
  lastResolvedAt: Date | null;
  lastSampleAt: Date | null;
}

export interface StoredAlarmRule extends Omit<AlarmRule, 'createdAt' | 'silencedUntil' | 'state'> {
  createdAt: Date;
  silencedUntil: Date | null;
  state: StoredAlarmRuleState;
}

const webhookSchema = new Schema<AlarmWebhook>(
  {
    method: { type: String, enum: webhookMethod.options, required: true, default: 'POST' },
    headers: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    triggeredPayload: { type: String, required: true, default: '' },
    resolvedPayload: { type: String, required: true, default: '' },
    reportErrors: { type: Boolean, required: true, default: true },
    tunnel: { type: Boolean, required: true, default: false },
  },
  { _id: false, versionKey: false, minimize: false },
);

/**
 * A rule's own delivery, kept from the per-alarm mail and webhook that predate
 * routing. `target` may name a host on the grower's own network and the headers
 * may carry an authorisation, so the serialiser answers this to whoever may
 * manage the device and to nobody else.
 */
const deliveryCustomSchema = new Schema<AlarmDeliveryCustom>(
  {
    channel: { type: String, enum: alarmDeliveryChannel.options, required: true },
    target: { type: String, required: true },
    includeDetails: { type: Boolean, required: true, default: true },
    webhook: { type: webhookSchema, default: null },
  },
  { _id: false, versionKey: false },
);

const deliverySchema = new Schema<AlarmDelivery>(
  {
    mode: { type: String, enum: alarmDeliveryMode.options, required: true, default: 'routing' },
    custom: { type: deliveryCustomSchema, default: null },
  },
  { _id: false, versionKey: false },
);

const stateSchema = new Schema<StoredAlarmRuleState>(
  {
    triggered: { type: Boolean, required: true, default: false },
    lastTriggeredAt: { type: Date, default: null },
    lastResolvedAt: { type: Date, default: null },
    // The worst reading of the episode that is open.
    extremeValue: { type: Number, default: null },
    lastSampleAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false },
);

export const alarmRulesSchema = new Schema<StoredAlarmRule>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    deviceId: { type: String, required: true },
    name: { type: String, required: true },
    metric: { type: String, enum: metric.options, required: true },
    upper: { type: Number, default: null },
    lower: { type: Number, default: null },
    forSeconds: { type: Number, required: true, default: 0 },
    severity: { type: String, enum: severity.options, required: true, default: 'warning' },
    origin: { type: String, enum: alarmOrigin.options, required: true, default: 'human' },
    // The preset that wrote this rule, so applying the stage again updates it
    // instead of writing a second one.
    presetId: { type: String, default: null },
    enabled: { type: Boolean, required: true, default: true },
    cooldownSeconds: { type: Number, required: true, default: 0 },
    repeatSeconds: { type: Number, required: true, default: 0 },
    delivery: { type: deliverySchema, required: true, default: () => ({}) },
    silencedUntil: { type: Date, default: null },
    state: { type: stateSchema, required: true, default: () => ({}) },
  },
  { collection: 'alarmRules', versionKey: false },
);

// Every sample the ingest takes asks for the rules on that device's metric.
alarmRulesSchema.index({ deviceId: 1, metric: 1 });
// Applying a stage preset again finds the rules that preset wrote on the device.
alarmRulesSchema.index({ deviceId: 1, presetId: 1 });
