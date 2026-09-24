import type { AccessNeed, Space, SpacePage } from '@fg2/shared-types/v1';
import type { SessionState } from '@/api/session';

/**
 * Who is looking, for the screens that ask.
 *
 * Every screen under test lives behind the sign-in wall, so a test that renders
 * one has somebody signed in - and what a screen offers depends on which
 * somebody: the demo may read the whole account and write nothing to it, which
 * is why the Log button and every Done are not drawn for it.
 *
 * The session is only half the question. The other half is the place: the same
 * account owns one tent and may only write lines in the next, so a test that
 * checks what a screen offers says which of the two it is by handing the space
 * list a `youMay` rather than by signing a second person in.
 */
const state = (user: SessionState['user']): SessionState => ({ user, tokens: null, sessionId: 'session-1', restored: true, unreachable: false, ended: false });

export const SIGNED_IN = state({ id: 'user-1', handle: 'you', isAdmin: false, isDemo: false });

export const ON_THE_DEMO = state({ id: 'user-demo', handle: 'demo', isAdmin: false, isDemo: true });

/** Nobody at all, which is who a public page is read by and the one state no screen may put a wall in front of. */
export const SIGNED_OUT = state(null);

/** The account `SIGNED_IN` is, as an owner id: what a thing standing in no place is checked against. */
export const YOU = 'user-1';

/** Somebody else, who owns the tents `SIGNED_IN` was let into rather than owns. */
export const THE_HOST = 'user-2';

/**
 * A place and the most the reader may do in it, as the server answers it.
 *
 * `own` belongs to the signed-in account; anything less is the host's tent that
 * account was let into, so the owner id follows the standing rather than having
 * to be repeated at every call.
 */
export const spaceWhere = (youMay: AccessNeed, over: Partial<Space> = {}): Space => ({
  id: 'space-1',
  ownerId: youMay === 'own' ? YOU : THE_HOST,
  youMay,
  kind: 'tent',
  name: 'Tent 1',
  roomId: null,
  presetPrompt: 'ask',
  retention: { climateDays: null },
  isDemo: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** The page `GET /spaces` answers, for a test that mocks the wire. */
export const spacePage = (...spaces: Space[]): SpacePage => ({ items: spaces, nextCursor: null });

/** What `useSpaces` returns, for a test that mocks the module instead of the wire. */
export const spacesAnswering = (...spaces: Space[]) => ({
  data: spacePage(...spaces),
  isPending: false,
  isError: false,
  dataUpdatedAt: 0,
  refetch: () => {},
});
