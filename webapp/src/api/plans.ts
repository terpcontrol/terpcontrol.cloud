import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Plan, PlanReplace, PlanTemplate, PlanTemplateCreate, PlanTemplatePage, PlanTransition } from '@fg2/shared-types/v1';
import { api } from './client';
import { growChanged } from './lifecycle';
import { ApiError } from './problem';

/**
 * The plan a controller is being run by, and the plans somebody keeps to start
 * others from.
 *
 * The plan moves on the engine's clock and not on ours: a step whose time is up
 * is advanced twenty seconds later whether or not anybody is looking, and a step
 * that waits asks for its confirmation the same way. So the plan is read on a
 * beat like the device list is, and every move ends by taking the answer the
 * server gave rather than by patching a status in.
 *
 * A device that is not being run by anything answers 404 rather than an empty
 * plan, which is a fact about it and not a failure - `isMissing` is how the
 * screen tells those two apart.
 */

/** The same beat a device row ages on: the engine's tick is faster, but nothing here is worth a read per tick. */
export const PLAN_REFRESH_MS = 30_000;

export const planKey = (deviceId: string) => ['devices', deviceId, 'plan'];

export const useDevicePlan = (deviceId: string) =>
  useRead({
    queryKey: planKey(deviceId),
    queryFn: ({ signal }) => api.get<Plan>(`/devices/${deviceId}/plan`, undefined, signal),
    refetchInterval: PLAN_REFRESH_MS,
  });

/** A device that runs no plan, which is what the screen offers to write one for. */
export const isMissing = (error: unknown): boolean => error instanceof ApiError && error.problem.code === 'plan_not_found';

/** The code the server refused with, for the screens that can offer a way out of one particular refusal. */
export const refusalCode = (error: unknown): string | null => (error instanceof ApiError ? error.problem.code : null);

/**
 * The whole plan, in place of whatever the device had. It does not start it:
 * saving a plan and running one are two things a person does, and the server
 * creates a new plan at rest for exactly that reason.
 */
export const useSavePlan = (deviceId: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: PlanReplace) => api.put<Plan>(`/devices/${deviceId}/plan`, body),
    onSuccess: plan => client.setQueryData(planKey(deviceId), plan),
  });
};

/**
 * Putting the plan away. It keeps its steps and stands at its first one again,
 * and the controller is left running whatever the last step gave it - so there
 * is nothing to read again but the plan itself.
 */
export const useStopPlan = (deviceId: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/devices/${deviceId}/plan`),
    onSuccess: () => client.invalidateQueries({ queryKey: planKey(deviceId) }),
  });
};

/**
 * Taking a plan that is at rest off the device, steps and all. The plan read is
 * reset rather than refreshed: a refresh that fails keeps the plan it last had,
 * and this one is meant to come back as "no plan".
 */
export const useRemovePlan = (deviceId: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/devices/${deviceId}/plan?steps=remove`),
    onSuccess: () => client.resetQueries({ queryKey: planKey(deviceId) }),
  });
};

/**
 * Confirming, skipping, extending, pausing and resuming. A move that changes the
 * step writes the grow's phase and a diary line with it, so the grow, the home
 * cards and the diary are read again - the same list a phase written by hand
 * invalidates, because it is the same fact arriving from the other end.
 */
export const usePlanTransition = (deviceId: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: PlanTransition) => api.post<Plan>(`/devices/${deviceId}/plan/transitions`, body),
    onSuccess: plan => {
      client.setQueryData(planKey(deviceId), plan);
      growChanged(client);
    },
  });
};

/** Every template this account may start from: its own, and the ones anybody published. Newest first. */
export const usePlanTemplates = () =>
  useRead({
    queryKey: ['plan-templates'],
    queryFn: ({ signal }) => api.get<PlanTemplatePage>('/plan-templates', { limit: 50 }, signal),
  });

export const useSavePlanTemplate = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: PlanTemplateCreate) => api.post<PlanTemplate>('/plan-templates', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['plan-templates'] }),
  });
};
