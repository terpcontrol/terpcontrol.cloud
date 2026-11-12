import type { DateTime } from 'luxon';
import type { DueTask, Task } from '@fg2/shared-types/v1';
import { useTasks } from '@/api/tasks';
import { enough, useMayInEach } from '@/ui/session-access';
import { useZone } from '@/ui/zone';
import { daysUntil } from '@/screens/tasks/tasks';

/**
 * What is due on Start: the diary's reminders, which the home's cards carry,
 * and the steps of a grow plan waiting for their word, which are read with
 * the tasks. "Heute" lists both, and a place's card counts them.
 */

/** A task that is due, with where it stands: the place, and the grow a line about it is written against. */
export interface Due {
  task: DueTask;
  spaceId: string | null;
  place: string;
  grow: { growId: string; name: string } | null;
}

/** A place Start lists what is due in, with the grows standing there: a task is about a place or about a grow. */
export interface Place {
  spaceId: string;
  name: string;
  growIds: string[];
}

/** A step of a grow plan waiting for its word, and the place whose device runs the plan. */
interface WaitingStep {
  task: Task;
  place: Place;
}

/** What is due today or overdue, the longest overdue first. */
export const dueNow = (due: Due[], now: DateTime, zone: string | null): Due[] =>
  due.filter(one => daysUntil(one.task.dueAt, now, zone) <= 0).sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt));

/**
 * The steps of a grow plan that have served their time and wait to be
 * confirmed, in the places this session may steer. They are read with the
 * tasks rather than with the place, and only by whoever could confirm one. A
 * step is about the grow standing where the plan's device stands, and about
 * the place itself where nothing grows there - so it is found by either.
 */
export const useWaitingSteps = (places: Place[], now: DateTime): WaitingStep[] => {
  const zone = useZone();
  const mayIn = useMayInEach();
  const steered = places.filter(place => enough(mayIn(place.spaceId), 'manage'));
  const waiting = useTasks(false, steered.length > 0).data?.items ?? [];

  return waiting.flatMap(task => {
    if (task.source !== 'plan_step' || daysUntil(task.dueAt, now, zone) > 0) return [];
    const { type, id } = task.subject;
    const place = steered.find(one => (type === 'space' ? one.spaceId === id : one.growIds.includes(id)));
    return place ? [{ task, place }] : [];
  });
};
