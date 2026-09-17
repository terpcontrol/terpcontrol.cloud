import { derivedId } from '../ids';
import { LEGACY, LegacyAlarm, LegacyDevice, createdAtOf, instantOf, numberOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { DeviceFacts, loadDeviceFacts } from '../device-facts';

/**
 * Every alarm on every device becomes a rule, and an alarm that is standing
 * triggered also gets the open alert it has never had a document for.
 *
 * What the old shape does not say, decided here:
 *
 * - **An alarm on an output is not migrated.** Today a rule may watch
 *   `dehumidifier`, `heater`, `fan`, `light` or `co2_valve` - the state of an
 *   output, not a reading. The model's `metric` is the sensor enum and outputs
 *   are a different vocabulary in it, so there is nowhere for such a rule to go.
 *   They are rejected by name, and the legacy device document keeps them for
 *   whoever wants to write them again. This is the one transform that loses
 *   something a person configured.
 * - **Severity.** Nothing records one. An alarm whose action was `info` is an
 *   `info` rule, because that is what it was for; everything that sent mail or
 *   called a webhook is a `warning`, which is what the old diary line was
 *   written at.
 * - **`origin`.** Every migrated rule is `human`: presets and the always-on
 *   offline rule do not exist yet, so every rule that is there was made by hand.
 * - **The open alert's `value`.** Only the extreme of the episode was ever kept,
 *   so the reading that tripped it is `null` and `extremeValue` carries what
 *   there is. An alarm standing triggered with no `lastTriggeredAt` is dated to
 *   the migration, because an open alert has to have started somewhere.
 * - **A resolved alarm gets no closed alert.** Its history is two diary lines
 *   that nothing can reliably pair; the entries stay and say what happened.
 */

const METRIC: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  co2: 'co2',
  leaf_temperature: 'leafTemperature',
  lux: 'lux',
  vpd: 'vpd',
  ppfd: 'ppfd',
};

export const alarmRules: MigrationStep = {
  name: '007-alarm-rules',

  async run(context: MigrationContext): Promise<void> {
    await context.renameAside(LEGACY.devices);
    const facts = await loadDeviceFacts(context);
    const legacy = await context.source(LEGACY.devices);
    const seen = new Set<string>();

    for await (const device of legacy.find<LegacyDevice>({ 'alarms.0': { $exists: true } }).sort({ _id: 1 })) {
      const deviceId = textOf(device.device_id);
      const fact = deviceId ? facts.get(deviceId) : undefined;
      if (!deviceId || !fact) continue;

      for (const alarm of device.alarms ?? []) {
        context.count('alarmRules.read');
        await migrateAlarm(context, fact, device, alarm, seen);
      }
    }
  },
};

const migrateAlarm = async (
  context: MigrationContext,
  fact: DeviceFacts,
  device: LegacyDevice,
  alarm: LegacyAlarm,
  seen: Set<string>,
): Promise<void> => {
  const id = textOf(alarm.alarmId);
  const sensorType = textOf(alarm.sensorType);
  const metric = sensorType ? METRIC[sensorType] : undefined;

  if (!id || !sensorType) {
    context.reject({ source: LEGACY.devices, id: `${fact.id}#alarm`, reason: 'an alarm without an id or a sensor', dropped: true, detail: null });
    return;
  }
  if (!metric) {
    context.reject({
      source: LEGACY.devices,
      id,
      reason: 'the alarm watches an output rather than a reading, which the model has no rule for',
      dropped: true,
      detail: `${fact.id}: ${sensorType}`,
    });
    return;
  }
  if (seen.has(id)) {
    context.reject({ source: LEGACY.devices, id, reason: 'a second alarm carries this alarmId', dropped: true, detail: fact.id });
    return;
  }
  seen.add(id);

  const severity = alarm.actionType === 'info' ? 'info' : 'warning';
  const triggered = alarm.isTriggered === true;
  const lastTriggeredAt = instantOf(alarm.lastTriggeredAt);

  await context.write('alarmRules', {
    id,
    createdAt: createdAtOf(device),
    deviceId: fact.id,
    name: textOf(alarm.name) ?? sensorType,
    metric,
    upper: numberOf(alarm.upperThreshold),
    lower: numberOf(alarm.lowerThreshold),
    forSeconds: numberOf(alarm.thresholdSeconds) ?? 0,
    severity,
    origin: 'human',
    presetId: null,
    enabled: alarm.disabled !== true,
    cooldownSeconds: numberOf(alarm.cooldownSeconds) ?? 0,
    repeatSeconds: numberOf(alarm.retriggerSeconds) ?? 0,
    delivery: deliveryOf(alarm),
    silencedUntil: null,
    state: {
      triggered,
      lastTriggeredAt,
      lastResolvedAt: instantOf(alarm.lastResolvedAt),
      extremeValue: triggered ? numberOf(alarm.extremeValue) : null,
      lastSampleAt: instantOf(alarm.latestDataPointTime),
    },
  });

  if (!triggered) return;

  const startedAt = lastTriggeredAt ?? context.at;
  await context.write('alerts', {
    id: derivedId('alert', id, startedAt.getTime()),
    createdAt: context.at,
    ruleId: id,
    deviceId: fact.id,
    cameraId: null,
    spaceId: fact.spaceId,
    kind: 'threshold',
    severity,
    startedAt,
    resolvedAt: null,
    value: null,
    extremeValue: numberOf(alarm.extremeValue),
  });
};

/**
 * The per-alarm mail and webhook are kept exactly as they are, templates,
 * headers and tunnel included: `delivery.custom` is the field the model has for
 * them. An `info` alarm wrote a diary line and nothing else, which is what the
 * person's own notification routing now decides.
 */
const deliveryOf = (alarm: LegacyAlarm): Record<string, unknown> => {
  const target = textOf(alarm.actionTarget);
  if (alarm.actionType !== 'email' && alarm.actionType !== 'webhook') return { mode: 'routing', custom: null };
  if (!target) return { mode: 'routing', custom: null };

  return {
    mode: 'custom',
    custom: {
      channel: alarm.actionType,
      target,
      includeDetails: alarm.additionalInfo !== false,
      webhook:
        alarm.actionType === 'webhook'
          ? {
              method: textOf(alarm.webhookMethod) ?? 'POST',
              headers: alarm.webhookHeaders ?? {},
              triggeredPayload: alarm.webhookTriggeredPayload ?? '',
              resolvedPayload: alarm.webhookResolvedPayload ?? '',
              reportErrors: alarm.reportWebhookErrors === true,
              tunnel: alarm.tunnelWebhook === true,
            }
          : null,
    },
  };
};
