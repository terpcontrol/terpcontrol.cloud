import type { MemberRole, Membership, MembershipPage, Person } from '@fg2/shared-types/v1';

/**
 * The little arithmetic the member list does, kept out of the drawing so that
 * what a row means can be checked without a screen around it.
 *
 * Every question here comes back to one fact: the answer carries the rows of
 * this space and the rows of the room it stands in, told apart only by the
 * `spaceId` each one names. A row of the room's reaches into every place
 * grouped under it, and one person can hold two rows at once, one on the room
 * and one on this place. In a club that is the ordinary shape rather than an
 * edge case, so the list is folded to people before it is drawn: a person
 * twice on the screen, with two roles, is the one thing a guest list must not
 * do.
 */

/**
 * One person, however many rows carry them: the place's own row, the room's, and
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

const stronger = (left: MemberRole, right: MemberRole): MemberRole => (RANK[right] > RANK[left] ? right : left);

export const personOf = (page: MembershipPage, userId: string): Person | null => page.people.find(one => one.id === userId) ?? null;

/**
 * One guest per person, in the order people arrived, with those who are here
 * only through the room held back so the place's own read first.
 */
export const guestsOf = (page: MembershipPage, spaceId: string): Guest[] => {
  const byUser = new Map<string, Guest>();
  for (const row of page.items) {
    const guest = byUser.get(row.userId) ?? { userId: row.userId, here: null, viaRoom: null, role: row.role };
    if (row.spaceId === spaceId) guest.here = row;
    else guest.viaRoom = row;
    guest.role = stronger(guest.role, row.role);
    byUser.set(row.userId, guest);
  }

  return [...byUser.values()].sort((left, right) => Number(left.here === null) - Number(right.here === null));
};

/**
 * The rows a change of role is written to. A stronger role goes to the place's
 * own row, the room's where that is the only one; a weaker role to every row
 * that grants more, or the other one would go on granting what was just taken.
 */
export const rowsFor = ({ here, viaRoom }: Guest, role: MemberRole): Membership[] => {
  const rows = [here, viaRoom].filter((row): row is Membership => row !== null);
  const more = rows.filter(row => RANK[row.role] > RANK[role]);

  return more.length > 0 ? more : rows.slice(0, 1);
};

/** When a person last wrote here, or `null` for somebody who never has. */
export const lastLoggedOf = (page: MembershipPage, userId: string): string | null =>
  page.activity.find(one => one.userId === userId)?.lastEntryAt ?? null;

/** Whoever holds a row on `spaceId` itself, as they are named: "@handle" by account. */
export const mentionsOn = (page: MembershipPage | undefined, spaceId: string | null): Map<string, string> =>
  new Map(
    (page?.items ?? [])
      .filter(row => row.spaceId === spaceId)
      .flatMap(row => {
        const handle = personOf(page!, row.userId)?.handle;
        return handle ? [[row.userId, `@${handle}`] as const] : [];
      }),
  );

/** Names in a sentence: "@mara", "@mara und @jonas", "@mara, @jonas und @lea". */
export const inSentence = (names: readonly string[], language: string): string =>
  new Intl.ListFormat(language, { type: 'conjunction' }).format(names);
