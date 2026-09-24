import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Follow, FollowPage, ShareLink, ShareLinkCreate, ShareLinkPage, ShareLinkUpdate } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The owner's half of sharing: the links they have handed out, and the diaries
 * they keep reading.
 *
 * A link is listed by an id that is not its secret, so narrowing one, ending
 * one and forgetting one need no token; the token comes back on the list
 * because handing it out is the whole point of a link. Every write invalidates
 * the list rather than patching it, because the server owns the counters.
 */

export const useShareLinks = () =>
  useRead({
    queryKey: ['share-links'],
    queryFn: ({ signal }) => api.get<ShareLinkPage>('/share-links', { limit: 100 }, signal),
  });

const useLinkMutation = <T, V>(mutationFn: (variables: V) => Promise<T>) => {
  const queryClient = useQueryClient();

  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['share-links'] }) });
};

export const useCreateShareLink = () => useLinkMutation((body: ShareLinkCreate) => api.post<ShareLink>('/share-links', body));

export const useUpdateShareLink = () =>
  useLinkMutation(({ id, body }: { id: string; body: ShareLinkUpdate }) => api.patch<ShareLink>(`/share-links/${id}`, body));

/** Ending a link leaves it listed with the instant it stopped working on it, which is why it is not a deletion. */
export const useRevokeShareLink = () => useLinkMutation((id: string) => api.put<ShareLink>(`/share-links/${id}/revocation`));

export const useDeleteShareLink = () => useLinkMutation((id: string) => api.delete(`/share-links/${id}`));

/**
 * The grows this account follows, as ids. What a followed grow looks like comes
 * with the home answer, which carries the card; this list is only what says
 * whether the button reads "Follow" or "Following".
 */
export const useFollows = (enabled: boolean) =>
  useRead({
    queryKey: ['follows'],
    queryFn: ({ signal }) => api.get<FollowPage>('/follows', { limit: 100 }, signal),
    enabled,
  });

/** Both directions invalidate the home as well: a followed grow is a tile on it. */
const useFollowMutation = (send: (growId: string) => Promise<unknown>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: send,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['follows'] });
      await queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });
};

export const useFollowGrow = () => useFollowMutation(growId => api.put<Follow>(`/follows/${growId}`));

export const useUnfollowGrow = () => useFollowMutation(growId => api.delete(`/follows/${growId}`));
