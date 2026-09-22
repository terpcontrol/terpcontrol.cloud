import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, MeUpdate, NotificationSettings } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The account as its owner sees it, and the one way it is changed.
 *
 * The session holds only what every request needs of the person - the id, the
 * handle, whether it is the demo - so the screens that show the rest of the
 * account read `/me` for it. A change answers the whole account, which is put
 * straight into the cache: nothing here is worth a second round trip.
 */

export const meKey = ['me'];

export const useMe = () =>
  useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => api.get<Me>('/me', undefined, signal),
  });

export const useUpdateMe = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: MeUpdate) => api.patch<Me>('/me', body),
    onSuccess: me => client.setQueryData(meKey, me),
  });
};

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
