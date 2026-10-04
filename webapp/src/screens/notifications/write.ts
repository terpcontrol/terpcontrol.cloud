import type { Me, NotificationSettings } from '@fg2/shared-types/v1';
import { notificationsWith, useUpdateMe } from '@/api/account';

/**
 * One change to the settings, written whole.
 *
 * Every write is the entire settings object in one `PATCH /me`, so a card that
 * changes one address sends the grid and the quiet hours back as it read them.
 * Each card holds its own writer so that the refusal it gets appears under the
 * card that asked, while the screen reads the one flag that says any of them
 * is on its way.
 */
export const useWriteNotifications = (me: Me) => {
  const update = useUpdateMe();

  return {
    write: (change: Partial<NotificationSettings>) => update.mutate({ notifications: notificationsWith(me.notifications, change) }),
    error: update.error,
    pending: update.isPending,
  };
};
