import { queryOptions, useQueries, type QueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Membership, MembershipCreate, MembershipPage, MembershipUpdate } from '@fg2/shared-types/v1';
import { api } from './client';
import { invitesKey } from './invites';
import { invalidate, useWrite } from './write';

/**
 * Who is in a place besides its owner.
 *
 * The answer carries the rows of this space and of the room it stands in, and
 * a row says which of the two it is by the `spaceId` it names, so nothing here
 * splits them; the screen reads that off. `people` comes with it because a
 * membership names an account by id and a handle is the only name anybody gets.
 *
 * A row is written at the space it names: the server refuses a room's row
 * changed through a place. Every write answers one row and the lists are read
 * again rather than patched - all of them, because a room's row stands in the
 * list of every place of that room.
 */

const membersQuery = (spaceId: string) =>
  queryOptions({
    queryKey: ['space', spaceId, 'members'],
    queryFn: ({ signal }) => api.get<MembershipPage>(`/spaces/${spaceId}/members`, { limit: 100 }, signal),
  });

export const useMembers = (spaceId: string, enabled = true) => useRead({ ...membersQuery(spaceId), enabled });

/** The members of several rooms at once, by room: what a room lets in is said where a place chooses one. */
export const useRoomsMembers = (roomIds: readonly string[]) =>
  useQueries({
    queries: roomIds.map(membersQuery),
    combine: (results: { data?: MembershipPage }[]) => new Map(roomIds.map((roomId, index) => [roomId, results[index]?.data])),
  });

/**
 * Leaving is the same route as being let go, and it takes the place off the
 * home and out of the space list - so a write here invalidates those too rather
 * than leaving a tent on the screen that the next tap cannot open. The write
 * is done once the server answered: whoever left is on Start before the reads
 * are back. `lists` is 'none' for them - the list they stood on is no longer
 * theirs to read, and is only marked as old.
 */
const readAgain = (client: QueryClient, lists: 'active' | 'none', ...also: (readonly unknown[])[]) =>
  void Promise.all([
    client.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === 'space' && queryKey[2] === 'members', refetchType: lists }),
    invalidate(client, ['spaces'], ['home'], ...also),
  ]);

/** One row, named by the space it stands on and the account it lets in. */
type Row = { spaceId: string; userId: string };

export const useAddMember = (spaceId: string) =>
  useWrite(
    (body: MembershipCreate) => api.post<Membership>(`/spaces/${spaceId}/members`, body),
    client => readAgain(client, 'active'),
  );

export const useSetMemberRole = () =>
  useWrite(
    ({ spaceId, userId, role }: Row & MembershipUpdate) => api.patch<Membership>(`/spaces/${spaceId}/members/${userId}`, { role }),
    client => readAgain(client, 'active'),
  );

/**
 * Being shown the door also closes the door: the server revokes the code the
 * person came in on. So the keys are read again with the member lists, or the
 * place would go on offering a link that has just stopped opening anything.
 */
export const useRemoveMember = () =>
  useWrite(
    ({ spaceId, userId }: Row & { /** The reader leaves, and keeps no other way in. */ gone: boolean }) =>
      api.delete(`/spaces/${spaceId}/members/${userId}`),
    (client, _answer, { spaceId, gone }) => readAgain(client, gone ? 'none' : 'active', invitesKey(spaceId)),
  );
