import { AlarmRule, AlarmRuleState, AlarmWatch, Alert } from '@fg2/shared-types/v1';
import { StoredAlarmRule, StoredAlarmRuleState } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';

/** The stored documents as the contract has them: instants as ISO strings, and nothing a reader may not see. */

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

/**
 * The watch, with only the fields of its kind: the document carries a column
 * per arm and the contract carries one arm, so the null that a running output
 * has where a band would be never reaches a reader.
 */
const watchOf = (watch: AlarmWatch): AlarmWatch => {
  if (watch.kind === 'reading') return { kind: 'reading', metric: watch.metric, upper: watch.upper, lower: watch.lower };
  if (watch.kind === 'output_level') return { kind: 'output_level', output: watch.output, upper: watch.upper, lower: watch.lower };

  return { kind: 'output_running', output: watch.output };
};

const stateOf = (state: StoredAlarmRuleState): AlarmRuleState => ({
  triggered: state.triggered,
  lastTriggeredAt: iso(state.lastTriggeredAt),
  lastResolvedAt: iso(state.lastResolvedAt),
  extremeValue: state.extremeValue,
  lastSampleAt: iso(state.lastSampleAt),
});

/**
 * `delivery.custom` names a host on the grower's own network and its headers
 * carry whatever that host asks for, so it is answered to whoever may manage the
 * device and to nobody else. The mode stays visible either way: that a rule
 * reports somewhere of its own is not the secret.
 */
export const alarmRuleOf = (rule: StoredAlarmRule, mayManage: boolean): AlarmRule => ({
  id: rule.id,
  createdAt: rule.createdAt.toISOString(),
  deviceId: rule.deviceId,
  name: rule.name,
  watch: watchOf(rule.watch),
  forSeconds: rule.forSeconds,
  severity: rule.severity,
  origin: rule.origin,
  presetId: rule.presetId,
  enabled: rule.enabled,
  cooldownSeconds: rule.cooldownSeconds,
  repeatSeconds: rule.repeatSeconds,
  delivery: { mode: rule.delivery.mode, custom: mayManage ? rule.delivery.custom : null },
  silencedUntil: iso(rule.silencedUntil),
  state: stateOf(rule.state),
});

export const alertOf = (alert: StoredAlert): Alert => ({
  id: alert.id,
  createdAt: alert.createdAt.toISOString(),
  ruleId: alert.ruleId,
  deviceId: alert.deviceId,
  cameraId: alert.cameraId,
  spaceId: alert.spaceId,
  kind: alert.kind,
  severity: alert.severity,
  startedAt: alert.startedAt.toISOString(),
  resolvedAt: iso(alert.resolvedAt),
  value: alert.value,
  extremeValue: alert.extremeValue,
});
