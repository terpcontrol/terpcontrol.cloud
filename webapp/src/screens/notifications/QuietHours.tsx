import { useState } from 'react';
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
export function QuietHoursCard({ me, held, locked }: { me: Me; held: boolean; locked: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const quiet = me.notifications.quietHours;

  const set = (field: 'fromMinute' | 'toMinute', minute: number) => {
    if (!quiet) return;
    write({ quietHours: { ...quiet, [field]: minute } });
  };

  return (
    <div className={`${ui.card} ${styles.channel}`}>
      <div className={styles.channelHead}>
        <div className={styles.channelText}>
          <span className={`${styles.channelTitle} ${quiet ? 'mono' : ''}`}>
            {quiet
              ? t('notifications.quiet.window', { from: timeOf(quiet.fromMinute), to: timeOf(quiet.toMinute) })
              : t('notifications.quiet.offTitle')}
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
          <TimeField
            label={t('notifications.quiet.from')}
            value={timeOf(quiet.fromMinute)}
            locked={locked}
            onCommit={minute => set('fromMinute', minute)}
          />
          <TimeField
            label={t('notifications.quiet.to')}
            value={timeOf(quiet.toMinute)}
            locked={locked}
            onCommit={minute => set('toMinute', minute)}
          />
        </div>
      ) : null}
      <p className={ui.note}>{t('notifications.quiet.zone', { zone: me.preferences.timezone })}</p>
      <Refused error={error} />
    </div>
  );
}

/**
 * One end of the window, held as text while it is being typed.
 *
 * A time field hands over a whole time after every keystroke - typing the "2"
 * of 23:00 makes it 02:00 - so writing on each change would send a window
 * nobody asked for and, with the field held still while that write is on its
 * way, would lock the person out halfway through their own time. So the field
 * keeps what is in it, and the window is written when the field is left, or
 * when a change arrives while it is not focused, which is the picker handing
 * over a time rather than somebody typing one.
 */
function TimeField({ label, value, locked, onCommit }: { label: string; value: string; locked: boolean; onCommit: (minute: number) => void }) {
  const [text, setText] = useState(value);
  const [written, setWritten] = useState(value);

  // What the account says has moved - a write landed, or was refused - so the field says it again.
  if (written !== value) {
    setWritten(value);
    setText(value);
  }

  const commit = (typed: string) => {
    const minute = minuteOf(typed);
    if (minute === null) {
      setText(value);
      return;
    }
    if (typed !== value) onCommit(minute);
  };

  return (
    <label className={styles.field}>
      <span className="label">{label}</span>
      <input
        className={`mono ${ui.input}`}
        type="time"
        value={text}
        disabled={locked}
        onChange={event => {
          setText(event.target.value);
          if (document.activeElement !== event.target) commit(event.target.value);
        }}
        onBlur={event => commit(event.target.value)}
      />
    </label>
  );
}
