import { useTranslation } from 'react-i18next';
import type { Me, NotificationChannel } from '@fg2/shared-types/v1';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { usePushSubscription } from './push';
import { Switch } from './parts';
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
 */
export function RoutingGrid({ me, held }: { me: Me; held: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const subscription = usePushSubscription();
  const { channels, routing } = me.notifications;

  const configured: Record<NotificationChannel, boolean> = {
    // Push goes somewhere as soon as any browser of the account is subscribed, not only this one.
    push: subscription.data != null || me.pushSubscribed,
    telegram: channels.telegram !== null,
    email: channels.email !== null,
    webhook: channels.webhook !== null,
  };

  const keptSomewhere = CHANNELS.some(channel => !configured[channel] && CATEGORIES.some(category => routes(routing, category, channel)));

  return (
    <div className={styles.gridBlock}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <td />
            {CHANNELS.map(channel => (
              <th key={channel} scope="col" className={`mono ${styles.gridHead}`} data-off={!configured[channel]}>
                {t(`notifications.channel.${channel}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map(category => (
            <tr key={category}>
              <th scope="row" className={styles.gridRow}>
                {t(`notifications.category.${category}`)}
              </th>
              {CHANNELS.map(channel => {
                const on = routes(routing, category, channel);
                return (
                  <td key={channel} className={styles.gridCell}>
                    <Switch
                      name={t('notifications.grid.cell', {
                        category: t(`notifications.category.${category}`),
                        channel: t(`notifications.channel.${channel}`),
                      })}
                      on={on && configured[channel]}
                      disabled={held || !configured[channel]}
                      onToggle={() => write({ routing: routingWith(routing, category, channel, !on) })}
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
