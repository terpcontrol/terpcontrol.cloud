import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRead, useReadPages } from './read';
import type {
  Me,
  MeUpdate,
  NotificationSettings,
  PasswordChange,
  PushSubscription,
  PushSubscriptionCreate,
  SessionPage,
  SignupUser,
  TelegramLink,
  UserActivation,
  UserCreate,
} from '@fg2/shared-types/v1';
import { api } from './client';
import { session } from './session';

/**
 * The account as its owner sees it, and the one way it is changed.
 *
 * The session holds only what every request needs of the person - the id, the
 * handle, whether it is the demo - so the screens that show the rest of the
 * account read `/me` for it. A change answers the whole account, which is put
 * straight into the cache: nothing here is worth a second round trip.
 */

export const meKey = ['me'];

/**
 * The two writes that happen before there is a session to make them with.
 *
 * Signing up answers the account without its activation code, and says with
 * `isActive` whether this install lets it sign in at once or wants the code
 * from its mail first; the screen reads that answer rather than assuming
 * either. Activation is addressed by the code alone and answers nothing, so
 * that an open route never says which address an account belongs to.
 */
export const useSignUp = () => useMutation({ mutationFn: (body: UserCreate) => api.post<SignupUser>('/users', body) });

export const useActivateAccount = () => useMutation({ mutationFn: (body: UserActivation) => api.post<void>('/users/activations', body) });

/**
 * A screen that is waiting for the account to change behind its back - a
 * Telegram chat is linked from the other app - asks to be read again every so
 * often. The query takes the shortest interval of everyone reading it, so a
 * card can ask for its own beat without the screen around it knowing. A screen
 * that knows the answer will be refused - the demo has no account of its own -
 * says so rather than asking and drawing the refusal.
 */
export const useMe = (refetchEveryMs: number | false = false, enabled = true) =>
  useRead({
    queryKey: meKey,
    queryFn: ({ signal }) => api.get<Me>('/me', undefined, signal),
    refetchInterval: refetchEveryMs,
    enabled,
  });

export const useUpdateMe = () => {
  const client = useQueryClient();

  return useMutation({
    mutationKey: meKey,
    mutationFn: (body: MeUpdate) => api.patch<Me>('/me', body),
    onSuccess: me => client.setQueryData(meKey, me),
  });
};

/** Whether any change to the account is on its way, so that a screen full of switches holds still while one lands. */
export const useUpdatingMe = (): boolean => useIsMutating({ mutationKey: meKey }) > 0;

/**
 * The notification settings travel whole: `PATCH /me` replaces the object
 * rather than merging into it, so a screen that changes one switch sends the
 * rest back as it read them. The Telegram link is the one part a client never
 * invents - it is written back exactly as it came, or as null to unlink.
 */
export const notificationsWith = (current: NotificationSettings, change: Partial<NotificationSettings>): NotificationSettings => ({
  ...current,
  ...change,
});

/**
 * The two channels the account cannot switch on by itself. A browser is pushed
 * to once it has handed over the subscription its push service gave it, and a
 * chat is linked by opening a link the bot recognises. Neither changes the
 * account document, so neither touches the cache: what the browser holds is
 * read from the browser, and a linked chat shows up on the next read of the
 * account.
 */
export const useSubscribePush = () =>
  useMutation({ mutationFn: (body: PushSubscriptionCreate) => api.post<PushSubscription>('/me/push-subscriptions', body) });

export const useUnsubscribePush = () => useMutation({ mutationFn: (id: string) => api.delete(`/me/push-subscriptions/${id}`) });

export const useTelegramLink = () => useMutation({ mutationFn: () => api.post<TelegramLink>('/me/telegram-link') });

/**
 * Leaving for good. The route answers when the deletion has finished rather
 * than when it started, so what comes back is a server that has already
 * forgotten this account - which is why the session ends and the cache is
 * emptied here rather than on the screen: every query still held is a question
 * nobody will answer.
 */
export const useDeleteAccount = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete('/me'),
    onSuccess: async () => {
      await session.logOut();
      client.clear();
    },
  });
};

/**
 * A new password. The current one travels with it, because a stolen session
 * must not be able to keep itself by locking the owner out - which is also why
 * a wrong current password comes back as a refusal of this one request rather
 * than as the end of the session: the client retries a 401 once behind a fresh
 * token, finds the same answer, and hands the problem to the form.
 */
export const useChangePassword = () => useMutation({ mutationFn: (body: PasswordChange) => api.put<void>('/me/password', body) });

/**
 * Every browser and script this account is signed in with. Paged, because the
 * server pages it, and read a page at a time: a person who has signed in from
 * a phone, a laptop and a tab or two has a handful, and the one who has a
 * hundred is the one who most wants to see the end of the list.
 */
export const sessionsKey = ['sessions'];

export const useSessions = (enabled = true) =>
  useReadPages({
    queryKey: sessionsKey,
    queryFn: ({ pageParam, signal }) => api.get<SessionPage>('/sessions', { cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    enabled,
  });

/**
 * Ending one session from another. This session's own end is `session.logOut`,
 * which forgets the tokens first; a session ended here is somebody else's
 * browser, and the list is read again so that it is seen to be gone.
 */
export const useRevokeSession = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/sessions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
};

/**
 * Ending every other session at once, which is what somebody reaches for when a
 * laptop has gone missing rather than when a tab is stale. The server spares
 * the session asking, so this browser stays signed in and the list is read
 * again to show what is left of the others.
 */
export const useRevokeOtherSessions = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete('/sessions'),
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
};
