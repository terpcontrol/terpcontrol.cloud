import type { DateTime } from 'luxon';
import type { AccessNeed, GrowOrSpaceRef, Task } from '@fg2/shared-types/v1';
import { useGrows } from '@/api/grows';
import { useHomeShape } from '@/api/home';
import { useDiaryAnswer } from '@/api/layers';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { useTasks } from '@/api/tasks';
import { enough, growStanding, mayWithOf, standsIn, type Standing } from '@/ui/session-access';
import { useZone } from '@/ui/zone';
import { groupOf, isMine, subjectName } from '@/screens/tasks/tasks';

/**
 * What a task is about, for every list of tasks: its name, where it stands and
 * whether the reader may settle it. A place answers for itself; a grow by
 * where it stands now, and one standing nowhere is its owner's alone. Ticking
 * writes a diary line and needs `log`; a step of the grow plan moves the plan
 * on, which is `manage` - as the server decides both. Nothing is answered
 * before the grows and the places are, so no tick is drawn on a guess.
 */
export const useSubjects = () => {
  const { user } = useSession();
  const grows = useGrows().data?.items;
  const spaces = useSpaces().data?.items;
  const standingOf = (subject: GrowOrSpaceRef): Standing | null => {
    if (subject.type === 'space') return { ownerId: null, spaceId: subject.id };
    const grow = grows?.find(one => one.id === subject.id);

    return grow ? growStanding(grow) : null;
  };
  const mayOn = (subject: GrowOrSpaceRef, need: AccessNeed): boolean => {
    const standing = standingOf(subject);

    return standing !== null && enough(mayWithOf(user, spaces)(standing), need);
  };

  return {
    grows,
    spaces,
    standingOf,
    mayOn,
    mayTick: (task: Task): boolean => mayOn(task.subject, task.source === 'plan_step' ? 'manage' : 'log'),
    nameOf: (subject: GrowOrSpaceRef): string | null => subjectName(subject, grows, spaces),
  };
};

/** A task that is due for the reader, with where it stands. */
export interface Due {
  task: Task;
  /** The place it is about, or its grow stands in; null for a grow standing in none. */
  spaceId: string | null;
  /** What it is about by name, as the task list says it, and then the place a grow stands in. */
  where: string[];
  /** The grow a watering or a feeding is entered against: the one it is about, else the one standing in its place. */
  growId: string | null;
}

/**
 * What is due for the reader: the task list's "Heute" under "Meine", less what
 * the reader may not settle. Start's "Heute", a place card's count, the inbox
 * and the bell all read it here, so none counts or offers what another does
 * not - a task with somebody else's name on it is on the task list under
 * "Alle" and nowhere else. The read is the alerts' kind, on the live beat and
 * on focus, so a tick in another tab arrives as an alert does.
 *
 * The diary's reminders come with the diary; a step of the grow plan waiting
 * for its word is Steuerung's and comes without, to whoever steers a place.
 * The demo may settle nothing and is asked no list. `kept` is whether the
 * account keeps a diary, `across` whether a row has to say where.
 */
export const useDue = (now: DateTime): { rows: Due[]; kept: boolean; across: boolean } => {
  const { user } = useSession();
  const zone = useZone();
  const signedIn = user !== null && !user.isDemo;
  const kept = useDiaryAnswer() === true && signedIn;
  const { grows, spaces, mayTick, nameOf } = useSubjects();
  const steers = spaces?.some(space => enough(space.youMay, 'manage')) === true;
  const waiting = useTasks(false, kept || (signedIn && steers)).data?.items ?? [];
  const across = (useHomeShape(signedIn).data?.spaces ?? []).length > 1;

  const rows = waiting
    .filter(task => (kept || task.source === 'plan_step') && isMine(task, user?.id ?? null) && groupOf(task, now, zone) === 'today' && mayTick(task))
    .map(task => {
      const about = task.subject.type === 'grow' ? grows?.find(grow => grow.id === task.subject.id) : undefined;
      const spaceId = about ? standsIn(about) : task.subject.type === 'space' ? task.subject.id : null;
      const growId = (about ?? grows?.find(grow => spaceId !== null && standsIn(grow) === spaceId))?.id ?? null;
      const place = about && spaces?.find(space => space.id === spaceId)?.name;

      return { task, spaceId, where: [nameOf(task.subject), place].filter((name): name is string => !!name), growId };
    });

  return { rows, kept, across };
};
