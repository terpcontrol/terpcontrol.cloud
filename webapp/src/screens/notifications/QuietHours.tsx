import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Switch } from './parts';
import { useWriteNotifications } from './write';
import { DEFAULT_QUIET, minuteOf, timeOf } from './settings';
import styles from './Notifications.module.css';

/**
 * The window in which nothing but a critical alarm is sent. It is wall-clock
 * time in the person's own zone - the one the account names, not the one the
 * browser happens to be in - and a window across midnight simply runs from a
 * later minute to an earlier one.
 */
export function QuietHoursCard({ me, held }: { me: Me; held: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const quiet = me.notifications.quietHours;

  const set = (field: 'fromMinute' | 'toMinute', time: string) => {
    const minute = minuteOf(time);
    if (minute === null || !quiet) return;
    write({ quietHours: { ...quiet, [field]: minute } });
  };

  return (
    <div className={`${ui.card} ${styles.channel}`}>
      <div className={styles.channelHead}>
        <div className={styles.channelText}>
          <span className={`${styles.channelTitle} ${quiet ? 'mono' : ''}`}>
            {quiet ? t('notifications.quiet.window', { from: timeOf(quiet.fromMinute), to: timeOf(quiet.toMinute) }) : t('notifications.off')}
          </span>
          <span className={`${ui.note} ${styles.channelLine}`}>{t(quiet ? 'notifications.quiet.critical' : 'notifications.quiet.offLine')}</span>
        </div>
        <Switch
          name={t('notifications.quietHours')}
          on={quiet !== null}
          disabled={held}
          onToggle={() => write({ quietHours: quiet ? null : DEFAULT_QUIET })}
        />
      </div>

      {quiet ? (
        <div className={styles.times}>
          <label className={styles.field}>
            <span className="label">{t('notifications.quiet.from')}</span>
            <input
              className={`mono ${ui.input}`}
              type="time"
              value={timeOf(quiet.fromMinute)}
              disabled={held}
              onChange={event => set('fromMinute', event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className="label">{t('notifications.quiet.to')}</span>
            <input
              className={`mono ${ui.input}`}
              type="time"
              value={timeOf(quiet.toMinute)}
              disabled={held}
              onChange={event => set('toMinute', event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <p className={ui.note}>{t('notifications.quiet.zone', { zone: me.preferences.timezone })}</p>
      <Refused error={error} />
    </div>
  );
}
