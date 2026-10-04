import type { MemberRole, Membership, MembershipPage, Person } from '@fg2/shared-types/v1';

/**
 * The little arithmetic the member list does, kept out of the drawing so that
 * what a count means can be checked without a screen around it.
 *
 * Every question here comes back to one fact: the answer carries the rows of
 * this space and the rows of the room it stands in, told apart only by the
 * `spaceId` each one names. A row of the room's reaches into every tent grouped
 * under it, which is why it is drawn here and changed there - and why one
 * person can hold two rows at once, one on the room and one on this tent. In a
 * club that is the ordinary shape rather than an edge case, so the list is
 * folded to people before it is drawn: a person twice on the screen, with two
 * roles and counted twice, is the one thing a guest list must not do.
 */

/**
 * When each person last wrote in the space, as the server answers it beside the
 * rows. It is sparse on purpose: somebody who has never written is simply not
 * in it, which is a different thing from somebody whose last entry is old.
 */
export type Activity = MembershipPage['activity'][number];

/**
 * One person, however many rows carry them: the tent's own row, the room's, and
 * the stronger of the two roles, which is the one the server actually grants.
 */
export type Guest = {
  userId: string;
  here: Membership | null;
  viaRoom: Membership | null;
  role: MemberRole;
};

/** The order the roles stack in: a stronger role includes the weaker one. */
const RANK: Record<MemberRole, number> = { can_log: 1, can_manage: 2 };

export const stronger = (left: MemberRole, right: MemberRole): MemberRole => (RANK[right] > RANK[left] ? right : left);

export const isViaRoom = (row: Membership, spaceId: string): boolean => row.spaceId !== spaceId;

/** How many people reach in through the room, whether or not they are in the tent as well. */
export const viaRoomCount = (page: MembershipPage, spaceId: string): number =>
  new Set(page.items.filter(row => isViaRoom(row, spaceId)).map(row => row.userId)).size;

/** People, not rows: somebody in the room and in the tent is one. The owner is never a row and is always exactly one person. */
export const peopleCount = (page: MembershipPage): number => new Set(page.items.map(row => row.userId)).size + 1;

export const personOf = (page: MembershipPage, userId: string): Person | null => page.people.find(one => one.id === userId) ?? null;

/**
 * One guest per person, in the order people arrived, with those who are here
 * only through the room held back so the tent's own read first.
 */
export const guestsOf = (page: MembershipPage, spaceId: string): Guest[] => {
  const byUser = new Map<string, Guest>();
  for (const row of page.items) {
    const guest = byUser.get(row.userId) ?? { userId: row.userId, here: null, viaRoom: null, role: row.role };
    if (isViaRoom(row, spaceId)) guest.viaRoom = row;
    else guest.here = row;
    guest.role = stronger(guest.role, row.role);
    byUser.set(row.userId, guest);
  }

  return [...byUser.values()].sort((left, right) => Number(left.here === null) - Number(right.here === null));
};

/**
 * Whether the tent's own row is the one that decides what this person may do,
 * so that a menu on it changes something. A room row that already grants more
 * makes the tent's row moot, and a menu that showed the tent's weaker role
 * would be stating a permission the server does not enforce.
 */
export const decidesHere = (guest: Guest): boolean =>
  guest.here !== null && (guest.viaRoom === null || RANK[guest.viaRoom.role] <= RANK[guest.here.role]);

/** When a person last wrote here, or `null` for somebody who never has. */
export const lastLoggedOf = (page: MembershipPage, userId: string): string | null =>
  page.activity.find(one => one.userId === userId)?.lastEntryAt ?? null;
