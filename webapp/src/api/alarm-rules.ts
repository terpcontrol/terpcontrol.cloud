import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlarmRule, AlarmRuleCreate, AlarmRulePage, AlarmRuleUpdate, AlarmSilence } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The rules that watch a device, and the five things done to one.
 *
 * A rule belongs to its device, so the list is read per device and every write
 * to a rule ends by reading that device's list again - the answer to a write is
 * the rule, but what the screen draws is the list, and the rule's place in it
 * is decided by the server's own ordering.
 *
 * A rule's `state` moves with the alarm engine, which evaluates every sample the
 * device sends, so the list is read on the beat the device rows age on.
 */

export const RULES_REFRESH_MS = 30_000;

/** Every rule an account could be asked to draw at once: a device has a handful, never a page. */
const RULES_LIMIT = 100;

export const rulesKey = (deviceId: string) => ['devices', deviceId, 'alarm-rules'];

const readRules = (deviceId: string, signal?: AbortSignal) =>
  api.get<AlarmRulePage>(`/devices/${deviceId}/alarm-rules`, { limit: RULES_LIMIT }, signal);

export const useDeviceAlarmRules = (deviceId: string) =>
  useQuery({
    queryKey: rulesKey(deviceId),
    queryFn: ({ signal }) => readRules(deviceId, signal),
    refetchInterval: RULES_REFRESH_MS,
  });

/** The rules of several devices at once, for a list of alerts that names a rule by id and has to say what it watched. */
export const useAlarmRulesOf = (deviceIds: string[]) =>
  useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: rulesKey(deviceId),
      queryFn: ({ signal }: { signal?: AbortSignal }) => readRules(deviceId, signal),
      refetchInterval: RULES_REFRESH_MS,
    })),
    combine: results => {
      const byId = new Map<string, AlarmRule>();
      for (const result of results) for (const rule of result.data?.items ?? []) byId.set(rule.id, rule);
      return { rules: byId, isPending: results.some(result => result.isPending) };
    },
  });

const useRuleMutation = <Body>(deviceId: string, run: (body: Body) => Promise<unknown>) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSettled: () => client.invalidateQueries({ queryKey: rulesKey(deviceId) }),
  });
};

export const useCreateAlarmRule = (deviceId: string) =>
  useRuleMutation(deviceId, (body: AlarmRuleCreate) => api.post<AlarmRule>(`/devices/${deviceId}/alarm-rules`, body));

export const useUpdateAlarmRule = (deviceId: string) =>
  useRuleMutation(deviceId, ({ ruleId, body }: { ruleId: string; body: AlarmRuleUpdate }) => api.patch<AlarmRule>(`/alarm-rules/${ruleId}`, body));

export const useRemoveAlarmRule = (deviceId: string) => useRuleMutation(deviceId, (ruleId: string) => api.delete(`/alarm-rules/${ruleId}`));

/** Keep watching, say nothing for a while. The server's clock decides when the while is over. */
export const useSilenceAlarmRule = (deviceId: string) =>
  useRuleMutation(deviceId, ({ ruleId, body }: { ruleId: string; body: AlarmSilence }) => api.put<AlarmRule>(`/alarm-rules/${ruleId}/silence`, body));

export const useUnsilenceAlarmRule = (deviceId: string) =>
  useRuleMutation(deviceId, (ruleId: string) => api.delete(`/alarm-rules/${ruleId}/silence`));
