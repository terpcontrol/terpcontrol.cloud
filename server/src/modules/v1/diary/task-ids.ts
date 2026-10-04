import { badRequest } from '@common/v1/problem';

/**
 * The id of a derived task, read back into what derived it.
 *
 * Tasks are never stored, so their ids have to carry everything a completion
 * needs: the id is the only thing the client sends back. A reminder's task is
 * the reminder's own id, or that id and the instant the occurrence falls due; a plan
 * step's is its device and its position in the plan.
 *
 * `plan:` is a prefix nothing else can wear - a reminder's id is a uuid - so the
 * two forms are told apart without a lookup.
 */

export type TaskRef =
  { source: 'reminder'; reminderId: string; occurrence: string | null } | { source: 'plan_step'; deviceId: string; stepIndex: number };

const PLAN_PREFIX = 'plan:';

/**
 * Deterministic, so that the task a card draws and the task a completion names
 * are the same task - and different every time the step starts waiting again.
 *
 * The instant the step became active is what makes the second of those true.
 * Without it a plan that came back to a step it had already been confirmed on -
 * a loop, or a plan stopped and started again - would derive a task whose id an
 * entry already carried, and the tick that answered it months ago would answer
 * it for ever. The instant is written once when the step is entered and is the
 * same for every reader of the plan, so two clients derive one id.
 */
export const planTaskId = (deviceId: string, stepIndex: number, stepStartedAt: Date | null): string =>
  `${PLAN_PREFIX}${deviceId}:${stepIndex}:${stepStartedAt ? stepStartedAt.getTime() : 0}`;

export const parseTaskId = (taskId: string): TaskRef => {
  if (taskId.startsWith(PLAN_PREFIX)) {
    const rest = taskId.slice(PLAN_PREFIX.length);
    // The turn the step is on is the last field and is not read back: what a
    // completion has to find is the device and the step, and whether the plan
    // is still standing there is asked of the plan itself.
    const parts = rest.split(':');
    const turn = parts.length > 2 ? parts.pop() : undefined;
    const stepIndex = Number(parts.pop());
    const deviceId = parts.join(':');

    if (!deviceId || !Number.isInteger(stepIndex) || stepIndex < 0 || (turn !== undefined && !/^\d+$/.test(turn))) {
      throw badRequest('unknown_task', 'That is not the id of a task anything derives.', [{ field: 'id', code: 'unknown', detail: taskId }]);
    }

    return { source: 'plan_step', deviceId, stepIndex };
  }

  const cut = taskId.indexOf(':');
  return cut < 0
    ? { source: 'reminder', reminderId: taskId, occurrence: null }
    : { source: 'reminder', reminderId: taskId.slice(0, cut), occurrence: taskId.slice(cut + 1) };
};
