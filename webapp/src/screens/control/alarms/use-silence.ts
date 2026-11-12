import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { AlarmRule } from '@fg2/shared-types/v1';
import { useSilenceAlarmRule, useUnsilenceAlarmRule } from '@/api/alarm-rules';
import { useLog } from '@/log/log-context';
import { isAhead } from '@/ui/age';
import { ruleTitle } from './rules';

/** How long a silence from one tap holds. */
const SILENCE_SECONDS = 3600;

/**
 * Silencing a rule for an hour, and making it loud again: the one tap for a
 * rule that keeps announcing itself while somebody is already on it. The rule
 * goes on watching; only the announcement stops. It is offered where the rule
 * shows that it has raised - on its alert's card and on its own card under
 * Steuerung › Alarme - and is one thing in both: what was done is said in the
 * toast, and a silence is taken back there.
 */
export const useSilence = (rule: AlarmRule | null, deviceId: string, now: DateTime) => {
  const { t } = useTranslation();
  const { tell } = useLog();
  const silence = useSilenceAlarmRule(deviceId);
  const unsilence = useUnsilenceAlarmRule(deviceId);
  const silenced = rule !== null && isAhead(rule.silencedUntil, now);

  return {
    silenced,
    busy: silence.isPending || unsilence.isPending,
    error: silence.error ?? unsilence.error,
    toggle: () => {
      if (!rule) return;
      const told = { name: ruleTitle(t, rule) };
      const from = `silence-${rule.id}`;
      if (silenced) unsilence.mutate(rule.id, { onSuccess: () => tell({ label: t('alarms.told.loud', told), undo: null, from }) });
      else {
        silence.mutate(
          { ruleId: rule.id, body: { forSeconds: SILENCE_SECONDS } },
          { onSuccess: () => tell({ label: t('alarms.told.silenced', told), undo: () => unsilence.mutateAsync(rule.id), from }) },
        );
      }
    },
  };
};
