import { Model } from 'mongoose';
import type { AlarmWatch, OpenAlert } from '@fg2/shared-types/v1';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';

/**
 * The open alerts as a card lists them, for Home and for a space's overview.
 *
 * An alert stores the reading; its rule says what the reading is of and what
 * the rule is called. The name is what tells two alarms on one place apart:
 * without it, two rules on one sensor made two banners word for word the same.
 * Both are read off the rule as it stands, and off the copy the episode kept
 * where the rule has since been deleted. A rule on an output names no metric, so
 * the card says what happened without a unit to say it in.
 */
export const openAlertReader = async (rules: Model<StoredAlarmRule>, alerts: StoredAlert[]): Promise<(alert: StoredAlert) => OpenAlert> => {
  const ruleIds = [...new Set(alerts.flatMap(alert => (alert.ruleId ? [alert.ruleId] : [])))];
  const found =
    ruleIds.length === 0
      ? []
      : await rules.find({ id: { $in: ruleIds } }, { id: 1, name: 1, watch: 1 }).lean<Pick<StoredAlarmRule, 'id' | 'name' | 'watch'>[]>();
  const byId = new Map(found.map(rule => [rule.id, rule]));

  return alert => {
    const rule = alert.ruleId ? byId.get(alert.ruleId) : undefined;
    const watch: AlarmWatch | null = rule?.watch ?? alert.watched?.watch ?? null;

    return {
      alertId: alert.id,
      kind: alert.kind,
      severity: alert.severity,
      startedAt: alert.startedAt.toISOString(),
      value: alert.value,
      metric: watch?.kind === 'reading' ? watch.metric : null,
      name: rule?.name ?? alert.watched?.name ?? null,
    };
  };
};
