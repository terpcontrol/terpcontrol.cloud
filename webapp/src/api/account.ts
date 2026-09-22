import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, MeUpdate, NotificationSettings, PushSubscription, PushSubscriptionCreate, TelegramLink } from '@fg2/shared-types/v1';
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
 * A screen that is waiting for the account to change behind its back - a
 * Telegram chat is linked from the other app - asks to be read again every so
 * often. The query takes the shortest interval of everyone reading it, so a
 * card can ask for its own beat without the screen around it knowing. A screen
 * that knows the answer will be refused - the demo has no account of its own -
 * says so rather than asking and drawing the refusal.
 */
export const useMe = (refetchEveryMs: number | false = false, enabled = true) =>
  useQuery({
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
