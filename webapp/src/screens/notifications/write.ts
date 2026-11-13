import type { Me, NotificationCategory, NotificationSettings } from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { meKey, notificationsWith, useMailAlarms, useUpdateMe } from '@/api/account';
import { useLog } from '@/log/log-context';
import { moved } from '@/screens/me/save';
import { mailSaid } from './reach';
import { routes, routingWith } from './settings';

/**
 * One change to the settings, written whole.
 *
 * Every write is the entire settings object in one `PATCH /me`, so a card that
 * changes one address sends the grid and the quiet hours back as it read them.
 * Each card holds its own writer so that the refusal it gets appears under the
 * card that asked, while the screen reads the one flag that says any of them
 * is on its way. A write that landed is answered by the toast that names what
 * holds now, with the way back - also on the page the person has gone on to,
 * so the answer hangs on the write (`mutateAsync`) and not on the card.
 */
export const useWriteNotifications = (me: Me) => {
  const { t, i18n } = useTranslation();
  const update = useUpdateMe();
  const mail = useMailAlarms();
  const client = useQueryClient();
  const { tell } = useLog();

  /** The toast of a write that landed - a refusal is the card's to say. Taken back, `back` of the settings as they stand then goes into them. */
  const answer = (label: string, from: string, back: (now: NotificationSettings) => Partial<NotificationSettings>) =>
    tell({
      label,
      from: `notifications:${from}`,
      undo: () => {
        const now = client.getQueryData<Me>(meKey)!.notifications;
        return update.mutateAsync({ notifications: notificationsWith(now, back(now)) });
      },
    });

  return {
    /**
     * Writes `change` and answers with `label`. Taken back by what the changed parts held before - or by `back`,
     * where a part is a table and only one cell of it moved. The quiet hours are one control whichever end moved,
     * so their next answer takes the last one's place.
     */
    write: (change: Partial<NotificationSettings>, label: string, back?: (now: NotificationSettings) => Partial<NotificationSettings>) => {
      const before = Object.fromEntries(Object.keys(change).map(key => [key, me.notifications[key as keyof NotificationSettings]]));
      const from = 'quietHours' in change ? 'quietHours' : moved(me.notifications, change).join(' ');
      const landed = () => answer(label, from, back ?? (() => before));
      update.mutateAsync({ notifications: notificationsWith(me.notifications, change) }).then(landed, () => undefined);
    },
    /**
     * E-mail switched on in one tap, the same from the card's switch and from the notice: the server writes the login
     * address (one already set stays) and routes `rows` to it, critical alarms where none are named. The toast says what
     * mail carries by then; taken back as far as the tap went.
     */
    mailOn: (rows?: NotificationCategory[], done?: () => void) => {
      const { channels, routing } = me.notifications;
      const routed = (rows ?? [alertCategory('critical')!]).filter(row => !routes(routing, row, 'email'));
      const landed = (set: Me) => {
        done?.();
        answer(mailSaid(t, i18n.language, set), 'channels.email', now => ({
          channels: channels.email === null ? { ...now.channels, email: null } : now.channels,
          routing: routed.reduce((grid, row) => routingWith(grid, row, 'email', false), now.routing),
        }));
      };
      mail.mutateAsync(rows).then(landed, () => undefined);
    },
    error: update.error ?? mail.error,
    pending: update.isPending || mail.isPending,
  };
};
