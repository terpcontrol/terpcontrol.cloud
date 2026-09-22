import type { AccessNeed, Space } from '@fg2/shared-types/v1';
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
 * The same answer for a space known only by its id, read from the list the
 * shell already holds. A space that is not in the list is one this account
 * cannot see at all, so the answer is `undefined` rather than `view` - "not
 * yet" and "not yours" are different things and only one of them is worth
 * waiting for.
 */
export const useMayInSpace = (spaceId: string | null): AccessNeed | undefined => {
  const { user } = useSession();
  const spaces = useSpaces(spaceId !== null);

  if (spaceId === null) return undefined;
  if (user?.isDemo === true) return 'view';

  return spaces.data?.items.find(space => space.id === spaceId)?.youMay;
};

/**
 * Whether this session may change hardware in a given place: a socket's
 * override, a camera's settings, a film it is asked to render, the plan.
 *
 * Called without a place it answers only the session's half - the demo may
 * not - which is what the screens that stand above any one space need.
 */
export const useMayManage = (spaceId: string | null = null): boolean => {
  const { user } = useSession();
  const may = useMayInSpace(spaceId);

  if (user === null || user.isDemo) return false;

  return spaceId === null ? true : enough(may, 'manage');
};
