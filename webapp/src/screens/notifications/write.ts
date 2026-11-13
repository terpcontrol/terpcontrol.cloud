import type { Me, NotificationSettings } from '@fg2/shared-types/v1';
import { useQueryClient } from '@tanstack/react-query';
import { meKey, notificationsWith, useUpdateMe } from '@/api/account';
import { useLog } from '@/log/log-context';
import { moved } from '@/screens/me/save';

/**
 * One change to the settings, written whole.
 *
 * Every write is the entire settings object in one `PATCH /me`, so a card that
 * changes one address sends the grid and the quiet hours back as it read them.
 * Each card holds its own writer so that the refusal it gets appears under the
 * card that asked, while the screen reads the one flag that says any of them
 * is on its way. A write that landed is answered by the toast that names what
 * holds now, with the way back.
 */
export const useWriteNotifications = (me: Me) => {
  const update = useUpdateMe();
  const client = useQueryClient();
  const { tell } = useLog();

  return {
    /**
     * Writes `change` and answers with `label`. Taken back by putting what the changed parts held before into
     * the settings as they stand then - or by `back`, where a part is a table and only one cell of it moved.
     */
    write: (change: Partial<NotificationSettings>, label: string, back?: (now: NotificationSettings) => Partial<NotificationSettings>) => {
      const before = Object.fromEntries(Object.keys(change).map(key => [key, me.notifications[key as keyof NotificationSettings]]));
      update.mutate(
        { notifications: notificationsWith(me.notifications, change) },
        {
          onSuccess: () =>
            tell({
              label,
              from: `notifications:${moved(me.notifications, change).join(' ')}`,
              undo: () => {
                const now = client.getQueryData<Me>(meKey)!.notifications;
                return update.mutateAsync({ notifications: notificationsWith(now, back ? back(now) : before) });
              },
            }),
        },
      );
    },
    error: update.error,
    pending: update.isPending,
  };
};
