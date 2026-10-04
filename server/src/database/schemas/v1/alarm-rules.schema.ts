import { Schema } from 'mongoose';
import type {
  AlarmDelivery,
  AlarmDeliveryCustom,
  AlarmRule,
  AlarmRuleState,
  AlarmWatch,
  AlarmWebhook,
  Metric,
  OutputMetric,
} from '@fg2/shared-types/v1';
import {
  alarmDeliveryChannel,
  alarmDeliveryMode,
  alarmOrigin,
  alarmWatch,
  metric,
  outputMetric,
  severity,
  webhookMethod,
} from '@fg2/shared-types/v1-schemas';

/**
 * One rule on one thing a device says: a reading it measures or an output it
 * drives. What the rule says and where the engine has got to are apart: `state`
 * is the server's and no client writes it.
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
  /**
   * Which of a stage's bands a `preset` rule is, so the next stage finds it
   * whatever it has been renamed to. Server-side bookkeeping: it is not in the
   * contract and the serialiser leaves it out.
   */
  presetKey: string | null;
}

/**
 * The watch as one subdocument, with the field of every arm and only those of
 * its own kind filled - the way a camera stores the fields of the kind it is.
 * The contract is where a reading with an output name cannot be written down;
 * here the shape is flat so that `watch.metric` and `watch.output` are paths the
 * engine can ask for and an index can cover. `StoredAlarmRule.watch` is the
 * union all the same, so nothing reads a field the kind does not have.
 */
interface StoredAlarmWatch {
  kind: AlarmWatch['kind'];
  metric: Metric | null;
  output: OutputMetric | null;
  upper: number | null;
  lower: number | null;
}

const watchKinds = alarmWatch.options.map(option => option.shape.kind.value);

const watchSchema = new Schema<StoredAlarmWatch>(
  {
    kind: { type: String, enum: watchKinds, required: true },
    metric: { type: String, enum: [...metric.options, null], default: null },
    output: { type: String, enum: [...outputMetric.options, null], default: null },
    upper: { type: Number, default: null },
    lower: { type: Number, default: null },
  },
  { _id: false, versionKey: false },
);

const webhookSchema = new Schema<AlarmWebhook>(
  {
    method: { type: String, enum: webhookMethod.options, required: true, default: 'POST' },
    headers: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    // Not `required`: an empty template is the ordinary case and means "send
    // the payload the cloud has always sent", which the delivery reads it as -
    // and mongoose counts an empty string as a missing value, so requiring one
    // refuses every rule that does not template its own body.
    triggeredPayload: { type: String, default: '' },
    resolvedPayload: { type: String, default: '' },
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
    watch: { type: watchSchema, required: true },
    forSeconds: { type: Number, required: true, default: 0 },
    severity: { type: String, enum: severity.options, required: true, default: 'warning' },
    origin: { type: String, enum: alarmOrigin.options, required: true, default: 'human' },
    // The preset that wrote this rule, so applying the stage again updates it
    // instead of writing a second one.
    presetId: { type: String, default: null },
    presetKey: { type: String, default: null },
    enabled: { type: Boolean, required: true, default: true },
    cooldownSeconds: { type: Number, required: true, default: 0 },
    repeatSeconds: { type: Number, required: true, default: 0 },
    delivery: { type: deliverySchema, required: true, default: () => ({}) },
    silencedUntil: { type: Date, default: null },
    state: { type: stateSchema, required: true, default: () => ({}) },
  },
  { collection: 'alarmRules', versionKey: false },
);

// Every sample the ingest takes asks for the rules on that device's readings
// and on its outputs, and the health loop for the one that watches its silence.
alarmRulesSchema.index({ deviceId: 1, 'watch.metric': 1 });
alarmRulesSchema.index({ deviceId: 1, 'watch.output': 1 });
// A stage moving the thresholds finds each band's rule on the device by its key.
alarmRulesSchema.index({ deviceId: 1, presetKey: 1 });
