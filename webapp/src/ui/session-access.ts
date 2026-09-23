import type { AccessNeed, Placement, Space } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';

/**
 * What a session may do, and where.
 *
 * Two questions live here and they are not the same one. The demo is a tour of
 * somebody else's grow and may write nothing anywhere, which is a fact about
 * the session. Everything else is a fact about a *place*: the same account owns
 * one tent, manages a second for a club and may only write entries in a third,
 * and a screen that draws the same controls in all three is drawing a button
 * the server is about to refuse.
 *
 * The place's answer comes from the server, as `Space.youMay`, and is never
 * worked out here from an owner id and a membership list - the server decides
 * access and this only decides what to draw, so the two must not be able to
 * disagree.
 *
 * Which of the four needs a control wants is the same table the routes declare
 * with `@Requires`: `own` for claiming, unclaiming, unpairing, publishing and
 * everything about who else is here; `manage` for configuration, the plan, the
 * alarm rules, the sockets, a camera's settings and other people's entries;
 * `log` for writing a line, a photo or a tick of one's own. A screen that asks
 * for more than the route does hides a control somebody is allowed to use,
 * which is the same kind of lie in the other direction.
 */

/** The four needs as the ladder they are: `own` implies the rest, `manage` implies `log` and `view`. */
const LADDER: Record<AccessNeed, number> = { view: 0, log: 1, manage: 2, own: 3 };

/** Whether what somebody may do reaches what a control needs. */
export const enough = (youMay: AccessNeed | undefined, needed: AccessNeed): boolean => youMay !== undefined && LADDER[youMay] >= LADDER[needed];

/**
 * What this session may do in a space it has in its hands. `undefined` is the
 * honest answer while the space has not arrived: a screen waits rather than
 * drawing controls it may have to take away again.
 */
export const mayInSpace = (space: Space | null | undefined, isDemo: boolean): AccessNeed | undefined =>
  space === null || space === undefined ? undefined : isDemo ? 'view' : space.youMay;

/**
 * The same question asked of many places at once, as the question rather than
 * as an answer.
 *
 * A list that draws rows from more than one place - every device this account
 * has, every task that is due, the cameras of a whole account - cannot ask per
 * row, because a hook is not called in a loop. So this reads the list the shell
 * already holds once and hands back the lookup, which is a plain function and
 * may be called as often as there are rows.
 *
 * `enabled` is for the one reader that may have no place to ask about at all: a
 * screen standing above every place asks nothing rather than fetching the whole
 * list to answer a question it has not got a place for.
 */
export const useMayInEach = (enabled = true): ((spaceId: string | null) => AccessNeed | undefined) => {
  const { user } = useSession();
  const spaces = useSpaces(enabled);

  return (spaceId: string | null) => {
    if (spaceId === null) return undefined;
    if (user?.isDemo === true) return 'view';

    return spaces.data?.items.find(space => space.id === spaceId)?.youMay;
  };
};

/**
 * The same answer for a space known only by its id, read from the list the
 * shell already holds. A space that is not in the list is one this account
 * cannot see at all, so the answer is `undefined` rather than `view` - "not
 * yet" and "not yours" are different things and only one of them is worth
 * waiting for.
 */
export const useMayInSpace = (spaceId: string | null): AccessNeed | undefined => useMayInEach(spaceId !== null)(spaceId);

/** Something that stands somewhere: a device, a camera, a grow. Both fields are what the access decision is made of. */
export interface Standing {
  ownerId: string | null;
  spaceId: string | null;
}

/**
 * What this session may do with a thing that stands in a place.
 *
 * Whoever owns it may do everything with it wherever it is, which is the answer
 * for a device that has been claimed and not yet put anywhere and for a grow
 * with no fixed place; for everybody else the place it stands in decides,
 * exactly as `access()` decides it. A thing standing nowhere that is not yours
 * is one you could not have been shown at all, so it answers `undefined`.
 */
export const useMayWith = (): ((thing: Standing) => AccessNeed | undefined) => {
  const { user } = useSession();
  const mayIn = useMayInEach();

  return thing => {
    if (user === null) return undefined;
    if (user.isDemo) return 'view';
    if (thing.ownerId !== null && thing.ownerId === user.id) return 'own';

    return mayIn(thing.spaceId);
  };
};

/**
 * Where a grow stands now, which is the place that decides what may be done to
 * it. A grow is read through every place it has ever stood in and written to
 * only through the one it stands in today, so the open placement is the one
 * that answers; a grow with no fixed place is its owner's alone.
 */
export const standsIn = (grow: { placements: Placement[] }): string | null =>
  grow.placements.find(placement => placement.endedAt === null)?.spaceId ?? null;

/**
 * Where a grow stood last, which is what a screen looking at it needs and what
 * `standsIn` deliberately will not say.
 *
 * `standsIn` answers the open placement because that is the one a grow may be
 * written to through; a grow that has been harvested has none, and asking that
 * question of it gives nothing at all. But its Charts screen still has a tent
 * to name and an earlier run of that tent to offer, so this answers the newest
 * placement that named a place, open or closed. It decides nothing about
 * access - only what a finished grow is shown beside.
 */
export const stoodIn = (grow: { placements: Placement[] }): string | null => {
  const newest = [...grow.placements]
    .filter(placement => placement.spaceId !== null)
    .sort((one, other) => other.startedAt.localeCompare(one.startedAt))[0];

  return standsIn(grow) ?? newest?.spaceId ?? null;
};

/**
 * Whether this session reaches a given need in a given place.
 *
 * Called without a place it answers only the session's half - the demo may
 * not - which is what the screens that stand above any one space need: the
 * account's own settings, a chart view, the mute on the inbox.
 */
export const useMayIn = (spaceId: string | null, needed: AccessNeed): boolean => {
  const { user } = useSession();
  const may = useMayInSpace(spaceId);

  if (user === null || user.isDemo) return false;

  return spaceId === null ? true : enough(may, needed);
};

/**
 * Whether this session may change hardware in a given place: a socket's
 * override, a camera's settings, a film it is asked to render, the plan.
 */
export const useMayManage = (spaceId: string | null = null): boolean => useMayIn(spaceId, 'manage');

/** Whether this session may write a line of its own in a given place. */
export const useMayLogIn = (spaceId: string | null = null): boolean => useMayIn(spaceId, 'log');
