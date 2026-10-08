import { LIVE_BEAT_MS, useRead } from './read';
import type { TaskPage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The task list, which the server works out on every read: what a reminder's
 * rhythm says is due, and what a plan step is waiting to be told. Nothing is
 * stored, so there is nothing to patch into the cache after a tick - the list
 * is simply read again.
 *
 * It is read on a beat because both things that change it happen elsewhere: a
 * tick is written through the Log queue, whose toast may still take it back,
 * and a plan step falls due on the engine's clock whether or not anybody is
 * looking. The beat is the live one: a task is never more urgent than a device
 * row.
 */

/** A week ahead of tasks and two days of ticks fit in one page; there is no cursor to follow. */
const LIMIT = 100;

const tasksKey = (done: boolean) => ['tasks', done ? 'done' : 'waiting'];

/** What is waiting, the most overdue first - or, with `done`, what was ticked off in the last two days. */
export const useTasks = (done: boolean, enabled = true) =>
  useRead({
    queryKey: tasksKey(done),
    queryFn: ({ signal }) => api.get<TaskPage>('/tasks', { done, limit: LIMIT }, signal),
    refetchInterval: LIVE_BEAT_MS,
    enabled,
  });
