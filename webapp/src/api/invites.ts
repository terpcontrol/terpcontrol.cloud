import { useRead } from './read';
import type { Invite, InviteAcceptance, InviteCreate, InvitePage, InvitePreview } from '@fg2/shared-types/v1';
import { api } from './client';
import { invalidate, useWrite } from './write';

/**
 * The codes a tent hands out, and the two routes a guest walks in through.
 *
 * They are addressed from both ends, which is why the hooks are not all shaped
 * alike: making and listing name the space, while revoking, previewing and
 * accepting name the code, because the code is the whole proof of the
 * invitation and is all somebody who was sent a link holds.
 *
 * The preview is the one read here that a stranger makes. A code that is
 * revoked, has run out or was never issued answers the same empty preview with
 * a 200 rather than a refusal, so nothing in this file treats a dead code as an
 * error: `isValid` is the answer, and the screen says the one thing it may.
 */

export const invitesKey = (spaceId: string) => ['space', spaceId, 'invites'];

export const useInvites = (spaceId: string, enabled = true) =>
  useRead({
    queryKey: invitesKey(spaceId),
    queryFn: ({ signal }) => api.get<InvitePage>(`/spaces/${spaceId}/invites`, { limit: 100 }, signal),
    enabled,
  });

const useInviteMutation = <T, V>(spaceId: string, mutationFn: (variables: V) => Promise<T>) =>
  useWrite(mutationFn, client => invalidate(client, invitesKey(spaceId)));

export const useCreateInvite = (spaceId: string) =>
  useInviteMutation(spaceId, (body: InviteCreate) => api.post<Invite>(`/spaces/${spaceId}/invites`, body));

/** Revoking leaves the code listed with the instant it stopped working, which is why it is not a deletion. */
export const useRevokeInvite = (spaceId: string) => useInviteMutation(spaceId, (code: string) => api.put<Invite>(`/invites/${code}/revocation`));

/**
 * What a code leads to, read before there is any account to read it with. It is
 * capped per address on the server, so it is asked once and not on a beat: a
 * page that polled would spend somebody else's budget for them.
 */
export const useInvitePreview = (code: string) =>
  useRead({
    queryKey: ['invite', code],
    queryFn: ({ signal }) => api.get<InvitePreview>(`/invites/${encodeURIComponent(code)}`, undefined, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/**
 * Taking the invitation up. It answers the space as well as the row, because
 * somebody who has only ever seen a code would otherwise hold two ids and no
 * name - and the tent is new to every list this account keeps, so all of them
 * are read again.
 */
export const useAcceptInvite = () =>
  useWrite(
    (code: string) => api.post<InviteAcceptance>(`/invites/${encodeURIComponent(code)}/acceptances`),
    client => invalidate(client, ['spaces'], ['home']),
  );
