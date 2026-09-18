import { badRequest } from '@common/v1/problem';

/**
 * The id of a derived task, read back into what derived it.
 *
 * Tasks are never stored, so their ids have to carry everything a completion
 * needs: the id is the only thing the client sends back. A reminder's task is
 * the reminder's own id, or that id and the day the occurrence fell due; a plan
 * step's is its device and its position in the plan.
 *
 * `plan:` is a prefix nothing else can wear - a reminder's id is a uuid - so the
 * two forms are told apart without a lookup.
 */

export type TaskRef =
  { source: 'reminder'; reminderId: string; occurrence: string | null } | { source: 'plan_step'; deviceId: string; stepIndex: number };

const PLAN_PREFIX = 'plan:';

/** Deterministic, so that the task a card draws and the task a completion names are the same task. */
export const planTaskId = (deviceId: string, stepIndex: number): string => `${PLAN_PREFIX}${deviceId}:${stepIndex}`;

export const parseTaskId = (taskId: string): TaskRef => {
  if (taskId.startsWith(PLAN_PREFIX)) {
    const rest = taskId.slice(PLAN_PREFIX.length);
    const cut = rest.lastIndexOf(':');
    const stepIndex = Number(rest.slice(cut + 1));

    if (cut <= 0 || !Number.isInteger(stepIndex) || stepIndex < 0) {
      throw badRequest('unknown_task', 'That is not the id of a task anything derives.', [{ field: 'id', code: 'unknown', detail: taskId }]);
    }

    return { source: 'plan_step', deviceId: rest.slice(0, cut), stepIndex };
  }

  const cut = taskId.indexOf(':');
  return cut < 0
    ? { source: 'reminder', reminderId: taskId, occurrence: null }
    : { source: 'reminder', reminderId: taskId.slice(0, cut), occurrence: taskId.slice(cut + 1) };
};
