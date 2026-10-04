import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Membership, MembershipCreate, MembershipPage, MembershipUpdate } from '@fg2/shared-types/v1';
import { api } from './client';
import { invitesKey } from './invites';

/**
 * Who is in a tent besides its owner.
 *
 * The answer carries the rows of this space and of the room it stands in, and
 * a row says which of the two it is by the `spaceId` it names, so nothing here
 * splits them; the screen reads that off. `people` comes with it because a
 * membership names an account by id and a handle is the only name anybody gets.
 *
 * Every write answers one row and the list is read again rather than patched:
 * the room's rows are in it as well, and a row that was refused from the wrong
 * end must not be quietly moved in the cache as though it had not been.
 */

export const membersKey = (spaceId: string) => ['space', spaceId, 'members'];

export const useMembers = (spaceId: string, enabled = true) =>
  useRead({
    queryKey: membersKey(spaceId),
    queryFn: ({ signal }) => api.get<MembershipPage>(`/spaces/${spaceId}/members`, { limit: 100 }, signal),
    enabled,
  });

/**
 * Leaving is the same route as being let go, and it takes the place off the
 * home and out of the space list - so a write here invalidates those too rather
 * than leaving a tent on the screen that the next tap cannot open.
 */
const useMembersMutation = <T, V>(spaceId: string, mutationFn: (variables: V) => Promise<T>, also: QueryKey[] = []) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      for (const key of [membersKey(spaceId), ['spaces'], ['home'], ...also]) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
};

export const useAddMember = (spaceId: string) =>
  useMembersMutation(spaceId, (body: MembershipCreate) => api.post<Membership>(`/spaces/${spaceId}/members`, body));

export const useSetMemberRole = (spaceId: string) =>
  useMembersMutation(spaceId, ({ userId, role }: { userId: string } & MembershipUpdate) =>
    api.patch<Membership>(`/spaces/${spaceId}/members/${userId}`, { role }),
  );

/**
 * Being shown the door also closes the door: the server revokes the code the
 * person came in on. So the keys are read again with the member list, or the
 * tent would go on offering a link that has just stopped opening anything.
 */
export const useRemoveMember = (spaceId: string) =>
  useMembersMutation(spaceId, (userId: string) => api.delete(`/spaces/${spaceId}/members/${userId}`), [invitesKey(spaceId)]);
