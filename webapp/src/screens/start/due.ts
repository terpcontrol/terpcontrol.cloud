import type { DateTime } from 'luxon';
import type { DueTask, HomeSpaceCard, Task } from '@fg2/shared-types/v1';
import { useHomeShape } from '@/api/home';
import { useDiaryAnswer } from '@/api/layers';
import { useSession } from '@/api/session';
import { useTasks } from '@/api/tasks';
import { isPlace } from '@/app/places';
import { enough, useMayInEach } from '@/ui/session-access';
import { useZone } from '@/ui/zone';
import { daysUntil, isMine } from '@/screens/tasks/tasks';

/**
 * What is due. Start lists a place's work, whoever it is for: the diary's
 * reminders, which the home's cards carry, and the steps of a grow plan
 * waiting for their word, which are read with the tasks. The bell and the
 * inbox are about the reader, and count the task list's own answer.
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
  place: { spaceId: string | null; name: string };
}

/** What is due today or overdue, the longest overdue first, in the task list's own order. */
export const dueNow = (due: Due[], now: DateTime, zone: string | null): Due[] =>
  due
    .filter(one => daysUntil(one.task.dueAt, now, zone) <= 0)
    .sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt) || a.task.id.localeCompare(b.task.id));

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

/** What a list of due work holds: "Heute" on Start, "Aufgaben" in the inbox. */
export interface DueNow {
  rows: Due[];
  steps: WaitingStep[];
}

export const useDueList = (due: Due[], places: Place[], now: DateTime): DueNow => {
  const zone = useZone();
  const steps = useWaitingSteps(places, now);

  return { rows: dueNow(due, now, zone), steps };
};

/** Where a card's work stands; nowhere that is named while the home has not listed it. */
const standsIn = (card: HomeSpaceCard | undefined) => ({
  spaceId: card?.spaceId ?? null,
  place: card?.name ?? '',
  grow: card?.grow ? { growId: card.grow.growId, name: card.grow.name } : null,
});

/** What the home's cards say is due, each with where it stands; a grow in no place is a card too. */
export const dueOfCards = (cards: HomeSpaceCard[]): Due[] => cards.flatMap(card => card.dueTasks.map(task => ({ task, ...standsIn(card) })));

/** The home's places as "Heute" asks them: by name, with the grow standing there. */
export const placesOfCards = (cards: HomeSpaceCard[]): Place[] =>
  cards.filter(isPlace).map(card => ({ spaceId: card.spaceId, name: card.name, growIds: card.grow ? [card.grow.growId] : [] }));

/**
 * What is due for the reader, as `/tasks` lists it under "Meine": what the
 * bell counts and the inbox lists, from one read, so the two cannot disagree
 * and neither counts a task with somebody else's name on it. That read is the
 * alerts' kind - on the live beat and on focus - so a tick in another tab
 * arrives as an alert does; the home only says where a task stands, and
 * `across` whether that is one place of several. `kept` is whether the
 * account keeps a diary at all: without one, and in the demo, which may
 * settle nothing, no list is asked for.
 */
export const useDueEverywhere = (now: DateTime): DueNow & { kept: boolean; across: boolean } => {
  const { user } = useSession();
  const zone = useZone();
  const kept = useDiaryAnswer() === true && user !== null && !user.isDemo;
  const cards = useHomeShape(kept).data?.spaces ?? [];
  const mine = (useTasks(false, kept).data?.items ?? [])
    .filter(task => isMine(task, user?.id ?? null) && daysUntil(task.dueAt, now, zone) <= 0)
    .map(task => ({ task, ...standsIn(cards.find(card => (task.subject.type === 'space' ? card.spaceId : card.grow?.growId) === task.subject.id)) }));

  return {
    rows: mine.filter(one => one.task.source !== 'plan_step'),
    steps: mine.filter(one => one.task.source === 'plan_step').map(({ task, spaceId, place }) => ({ task, place: { spaceId, name: place } })),
    kept,
    across: cards.length > 1,
  };
};
