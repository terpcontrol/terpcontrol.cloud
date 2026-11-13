import { useTranslation } from 'react-i18next';
import type { Me, NotificationChannel } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { ownsCamera } from '@/screens/devices/cameras';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import { usePushSubscription } from './push';
import { useWriteNotifications } from './write';
import { isConfigured } from './reach';
import { CATEGORIES, CHANNELS, routes, routingWith } from './settings';
import styles from './Notifications.module.css';

/**
 * What goes where: a row per category, a column per channel, a switch in each
 * cell. A column whose channel is not configured is drawn off and cannot be
 * moved: a switch that reads on above nothing would be a promise the screen
 * cannot keep. What is stored for such a channel is not written away over it -
 * it is what the channel carries as soon as it has an address - and the help
 * beside the grid's heading says so (`routingGrid`).
 *
 * The weekly film's row is there only for an account that has a camera of its own, and
 * the due tasks' - the diary's reminders - only for one that keeps a diary.
 * The plan's questions are Steuerung's and stay.
 */
export function RoutingGrid({ me, held }: { me: Me; held: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const subscription = usePushSubscription();
  const { routing } = me.notifications;
  const cameras = useCameras();
  // A host's camera films for the host: the film of a place one is a guest in is not sent to the guest.
  const filmed = ownsCamera(cameras.data?.items.filter(camera => camera.ownerId === me.id) ?? []);
  // Until a server says otherwise the diary is there, which is the app as it has always been.
  const diary = me.layers?.diary !== false;
  const categories = CATEGORIES.filter(category => (category !== 'weekly_timelapse' || filmed) && (category !== 'tasks' || diary));

  // Push goes somewhere as soon as any browser of the account is subscribed, not only this one.
  const configured = (channel: NotificationChannel): boolean => isConfigured(me, channel) || (channel === 'push' && subscription.data != null);

  return (
    <div className={styles.gridBlock}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <td />
            {CHANNELS.map(channel => (
              <th key={channel} scope="col" className={styles.gridHead} data-off={!configured(channel)}>
                {t(`notifications.channel.${channel}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map(category => (
            <tr key={category}>
              <th scope="row" className={styles.gridRow}>
                {t(`notifications.category.${category}`)}
              </th>
              {CHANNELS.map(channel => {
                const on = routes(routing, category, channel);
                const cell = t('notifications.grid.cell', {
                  category: t(`notifications.category.${category}`),
                  channel: t(`notifications.channel.${channel}`),
                });
                return (
                  <td key={channel} className={styles.gridCell}>
                    <Switch
                      label={cell}
                      on={on && configured(channel)}
                      disabled={held || !configured(channel)}
                      onChange={() =>
                        write(
                          { routing: routingWith(routing, category, channel, !on) },
                          t(`notifications.told.${on ? 'off' : 'on'}`, { what: cell }),
                          t(`notifications.told.${on ? 'on' : 'off'}`, { what: cell }),
                          now => ({
                            routing: routingWith(now.routing, category, channel, on),
                          }),
                        )
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Refused error={error} />
    </div>
  );
}
