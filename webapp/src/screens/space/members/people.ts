import type { Membership, MembershipPage, Person } from '@fg2/shared-types/v1';

/**
 * The little arithmetic the member list does, kept out of the drawing so that
 * what a count means can be checked without a screen around it.
 *
 * Every question here comes back to one fact: the answer carries the rows of
 * this space and the rows of the room it stands in, told apart only by the
 * `spaceId` each one names. A row of the room's reaches into every tent grouped
 * under it, which is why it is drawn here and changed there.
 */

export const isViaRoom = (row: Membership, spaceId: string): boolean => row.spaceId !== spaceId;

export const viaRoomCount = (page: MembershipPage, spaceId: string): number => page.items.filter(row => isViaRoom(row, spaceId)).length;

/** The owner is never a row and is always exactly one person, so the list is one longer than it is. */
export const peopleCount = (page: MembershipPage): number => page.items.length + 1;

export const personOf = (page: MembershipPage, userId: string): Person | null => page.people.find(one => one.id === userId) ?? null;

/** The rows in the order people arrived, with the room's held back so the tent's own read first. */
export const sortedRows = (page: MembershipPage, spaceId: string): Membership[] =>
  [...page.items].sort((left, right) => Number(isViaRoom(left, spaceId)) - Number(isViaRoom(right, spaceId)));
