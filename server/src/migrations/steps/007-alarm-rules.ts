import { derivedId } from '../ids';
import { LEGACY, LegacyAlarm, LegacyDevice, createdAtOf, flagOf, instantOf, numberOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { DeviceFacts, loadDeviceFacts } from '../device-facts';

/**
 * Every alarm on every device becomes a rule, and an alarm that is standing
 * triggered also gets the open alert it has never had a document for.
 *
 * What the old shape does not say, decided here:
 *
 * - **An alarm on an output keeps watching its output.** A rule may watch
 *   `dehumidifier`, `heater`, `fan`, `light` or `co2_valve` - what the
 *   controller is driving rather than what it measures - and the model's watch
 *   says which of the two a rule is about. `co2_valve` is the model's `co2`
 *   output; the other four are named the same on both sides.
 * - **Which of the two output rules each becomes.** `dehumidifier` and
 *   `co2_valve` never had thresholds: the old engine tripped them on the output
 *   being on at all, whatever was stored beside them, which is the fridge that
 *   has not stopped and the valve that is still open. They become
 *   `output_running`, and a threshold left in the old document beside one is
 *   dropped: nothing has ever read it. The other three are bands on the
 *   output's level and become `output_level`.
 * - **The heater's percentage.** The old engine multiplied the heater's output
 *   by a hundred before comparing it, so its thresholds are percentages of a
 *   value the device reports as a fraction - the only output it did this for.
 *   The model compares an output against the number the series carries, so the
 *   thresholds are divided by a hundred here instead. The rule trips on exactly
 *   the readings it used to.
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

/** The five outputs an alarm could watch, in the names the model gives them. */
const OUTPUT: Record<string, string> = {
  dehumidifier: 'dehumidifier',
  heater: 'heater',
  fan: 'fan',
  light: 'light',
  co2_valve: 'co2',
};

/** The two the old engine tripped on the output running, never on a number. */
const RUNNING = new Set(['dehumidifier', 'co2_valve']);

/** The one output whose thresholds were percentages of a fraction. */
const PERCENT_OF = 100;

/** What the rule is about, in the shape the model has for it. */
const watchOf = (sensorType: string): Record<string, unknown> | null => {
  const metric = METRIC[sensorType];
  if (metric) return { kind: 'reading', metric, output: null };
  if (!OUTPUT[sensorType]) return null;

  return RUNNING.has(sensorType)
    ? { kind: 'output_running', metric: null, output: OUTPUT[sensorType] }
    : { kind: 'output_level', metric: null, output: OUTPUT[sensorType] };
};

/**
 * The band, as the watch carries it: none at all for an output watched for
 * running, and the heater's percentages back in the units the series is in.
 */
const boundsOf = (sensorType: string, alarm: LegacyAlarm): { upper: number | null; lower: number | null } => {
  if (RUNNING.has(sensorType)) return { upper: null, lower: null };

  const scale = sensorType === 'heater' ? PERCENT_OF : 1;
  const bound = (value: unknown): number | null => {
    const number = numberOf(value);
    return number === null ? null : number / scale;
  };

  return { upper: bound(alarm.upperThreshold), lower: bound(alarm.lowerThreshold) };
};

export const alarmRules: MigrationStep = {
  name: '007-alarm-rules',
  moves: [LEGACY.devices],

  async run(context: MigrationContext): Promise<void> {
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
  const watch = sensorType ? watchOf(sensorType) : null;

  if (!id || !sensorType) {
    context.reject({ source: LEGACY.devices, id: `${fact.id}#alarm`, reason: 'an alarm without an id or a sensor', dropped: true, detail: null });
    return;
  }
  if (!watch) {
    context.reject({
      source: LEGACY.devices,
      id,
      reason: 'the alarm watches something the model names neither a reading nor an output',
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
  const triggered = flagOf(alarm.isTriggered);
  const lastTriggeredAt = instantOf(alarm.lastTriggeredAt);

  if (watch.kind !== 'reading') context.count('alarmRules.onAnOutput');

  await context.write('alarmRules', {
    id,
    createdAt: createdAtOf(device),
    deviceId: fact.id,
    name: textOf(alarm.name) ?? sensorType,
    watch: { ...watch, ...boundsOf(sensorType, alarm) },
    forSeconds: numberOf(alarm.thresholdSeconds) ?? 0,
    severity,
    origin: 'human',
    presetId: null,
    enabled: !flagOf(alarm.disabled),
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
      includeDetails: flagOf(alarm.additionalInfo, true),
      webhook:
        alarm.actionType === 'webhook'
          ? {
              method: textOf(alarm.webhookMethod) ?? 'POST',
              headers: alarm.webhookHeaders ?? {},
              triggeredPayload: alarm.webhookTriggeredPayload ?? '',
              resolvedPayload: alarm.webhookResolvedPayload ?? '',
              reportErrors: flagOf(alarm.reportWebhookErrors),
              tunnel: flagOf(alarm.tunnelWebhook),
            }
          : null,
    },
  };
};
