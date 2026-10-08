import { useTranslation } from 'react-i18next';
import type { Me, NotificationChannel } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { ownsCamera } from '@/screens/devices/cameras';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { usePushSubscription } from './push';
import { useWriteNotifications } from './write';
import { CATEGORIES, CHANNELS, routes, routingWith } from './settings';
import styles from './Notifications.module.css';

/**
 * What goes where: a row per category, a column per channel, a switch in each
 * cell. A column whose channel is not configured is drawn off and cannot be
 * moved, because a category routed to a channel with no address goes nowhere,
 * and a switch that reads on above nothing would be a promise the screen
 * cannot keep. What is stored for such a channel is not written away over it,
 * though - it is what the channel will carry as soon as it has an address -
 * and the line under the grid says so, so that a column of grey switches is
 * not read as work the person has to do again.
 *
 * The weekly film is made from a camera's stills, so its row is there only for
 * an account that has a camera; without one it was a switch for something that
 * could never arrive. Due tasks are the diary's reminders - watering, feeding,
 * a chore of the grow - so their row is there only for an account that keeps
 * one. The plan's questions are Steuerung's and stay.
 */
export function RoutingGrid({ me, held }: { me: Me; held: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const subscription = usePushSubscription();
  const { channels, routing } = me.notifications;
  const cameras = useCameras();
  const filmed = cameras.data !== undefined && ownsCamera(cameras.data.items);
  // Until a server says otherwise the diary is there, which is the app as it has always been.
  const diary = me.layers?.diary !== false;
  const categories = CATEGORIES.filter(category => (category !== 'weekly_timelapse' || filmed) && (category !== 'tasks' || diary));

  const configured: Record<NotificationChannel, boolean> = {
    // Push goes somewhere as soon as any browser of the account is subscribed, not only this one.
    push: subscription.data != null || me.pushSubscribed,
    telegram: channels.telegram !== null,
    email: channels.email !== null,
    webhook: channels.webhook !== null,
  };

  const keptSomewhere = CHANNELS.some(channel => !configured[channel] && categories.some(category => routes(routing, category, channel)));

  return (
    <div className={styles.gridBlock}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <td />
            {CHANNELS.map(channel => (
              <th key={channel} scope="col" className={styles.gridHead} data-off={!configured[channel]}>
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
                return (
                  <td key={channel} className={styles.gridCell}>
                    <Switch
                      label={t('notifications.grid.cell', {
                        category: t(`notifications.category.${category}`),
                        channel: t(`notifications.channel.${channel}`),
                      })}
                      on={on && configured[channel]}
                      disabled={held || !configured[channel]}
                      onChange={() => write({ routing: routingWith(routing, category, channel, !on) })}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={ui.note}>{t('notifications.grid.note')}</p>
      {keptSomewhere ? <p className={ui.note}>{t('notifications.grid.kept')}</p> : null}
      <Refused error={error} />
    </div>
  );
}
