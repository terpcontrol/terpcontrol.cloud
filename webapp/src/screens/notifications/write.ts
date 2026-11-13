import type { Me, MeUpdate, NotificationCategory, NotificationSettings } from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { useTranslation } from 'react-i18next';
import { notificationsWith, useMailAlarms } from '@/api/account';
import { useSaveAccount } from '@/screens/me/save';
import { mailSaid } from './reach';
import { routes, routingWith } from './settings';

/** What is put back into the notification settings, as an update of the account they stand in at that moment. */
const within =
  (back: (now: NotificationSettings) => Partial<NotificationSettings>) =>
  (now: Me): MeUpdate => ({ notifications: notificationsWith(now.notifications, back(now.notifications)) });

/**
 * One change to the notification settings, written whole and answered as
 * every setting of the account is (`useSaveAccount`).
 *
 * Every write is the entire settings object in one `PATCH /me`, so a card that
 * changes one address sends the grid and the quiet hours back as it read them.
 * Each card holds its own writer so that the refusal it gets appears under the
 * card that asked, while the screen reads the one flag that says any of them
 * is on its way.
 */
export const useWriteNotifications = (me: Me) => {
  const { t, i18n } = useTranslation();
  const account = useSaveAccount();
  const mail = useMailAlarms();

  return {
    /**
     * Writes `change` and answers with `label`. Taken back by what the changed parts held before - or by `back`,
     * where a part is a table and only one cell of it moved - and `undone` is what the toast says holds again. The
     * quiet hours are one control whichever end moved, so their next answer takes the last one's place.
     */
    write: (
      change: Partial<NotificationSettings>,
      label: string,
      undone: string,
      back?: (now: NotificationSettings) => Partial<NotificationSettings>,
    ) => {
      const before = Object.fromEntries(Object.keys(change).map(key => [key, me.notifications[key as keyof NotificationSettings]]));
      const from = 'quietHours' in change ? 'notifications.quietHours' : undefined;
      account.save(
        { notifications: notificationsWith(me.notifications, change) },
        label,
        { to: within(back ?? (() => before)), undone },
        undefined,
        from,
      );
    },
    /**
     * E-mail switched on in one tap, the same from the card's switch and from the notice: the server writes the login
     * address (one already set stays) and routes `rows` to it, critical alarms where none are named. The toast says what
     * mail carries by then; taken back as far as the tap went.
     */
    mailOn: (rows?: NotificationCategory[], done?: () => void) => {
      const { channels, routing } = me.notifications;
      const routed = (rows ?? [alertCategory('critical')!]).filter(row => !routes(routing, row, 'email'));
      const back = within(now => ({
        channels: channels.email === null ? { ...now.channels, email: null } : now.channels,
        routing: routed.reduce((grid, row) => routingWith(grid, row, 'email', false), now.routing),
      }));
      const before =
        channels.email === null ? t('notifications.told.off', { what: t('notifications.channel.email') }) : mailSaid(t, i18n.language, me);
      const landed = (set: Me) => {
        done?.();
        account.answer(mailSaid(t, i18n.language, set), 'notifications.channels.email', { to: back, undone: before });
      };
      mail.mutateAsync(rows).then(landed, () => undefined);
    },
    error: account.error ?? mail.error,
    pending: account.pending || mail.isPending,
  };
};
