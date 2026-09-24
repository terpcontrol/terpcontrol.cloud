import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me, QuietHours } from '@fg2/shared-types/v1';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Switch } from './parts';
import { useWriteNotifications } from './write';
import { DEFAULT_QUIET, minuteOf, timeOf } from './settings';
import styles from './Notifications.module.css';

const sameWindow = (one: QuietHours | null, other: QuietHours | null): boolean =>
  one === other || (one !== null && other !== null && one.fromMinute === other.fromMinute && one.toMinute === other.toMinute);

/**
 * The window in which nothing but a critical alarm is sent. It is wall-clock
 * time in the person's own zone - the one the account names, not the one the
 * browser happens to be in - and a window across midnight simply runs from a
 * later minute to an earlier one.
 *
 * Both ends are one window and are written as one. Somebody setting quiet
 * hours moves both of them, one straight after the other, and a settings write
 * carries the whole account: a second write built on what the account still
 * says would carry the old value of the end that was already moved and put it
 * back, so the first of two quick edits would simply vanish. The card
 * therefore holds the window it means rather than reading it back off the
 * account between edits, and every write carries both ends as the card has
 * them. The draft is dropped once the account agrees; a window the server
 * refused stays in the fields beside the refusal.
 */
export function QuietHoursCard({ me, held, locked }: { me: Me; held: boolean; locked: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const quiet = me.notifications.quietHours;
  const [wanted, setWanted] = useState<QuietHours | null>(null);

  // The account has caught up with what was asked for, so there is nothing left to hold.
  if (wanted && sameWindow(wanted, quiet)) setWanted(null);

  const shown = wanted ?? quiet;

  const set = (field: 'fromMinute' | 'toMinute', minute: number) => {
    if (!shown) return;
    const next = { ...shown, [field]: minute };
    setWanted(next);
    write({ quietHours: next });
  };

  const toggle = () => {
    setWanted(null);
    write({ quietHours: shown ? null : DEFAULT_QUIET });
  };

  return (
    <div className={`${ui.card} ${ui.joined} ${styles.channel}`}>
      <div className={styles.channelHead}>
        <div className={styles.channelText}>
          <span className={`${styles.channelTitle} ${shown ? 'mono' : ''}`}>
            {shown
              ? t('notifications.quiet.window', { from: timeOf(shown.fromMinute), to: timeOf(shown.toMinute) })
              : t('notifications.quiet.offTitle')}
          </span>
          <span className={`${ui.note} ${styles.channelLine}`}>{t(shown ? 'notifications.quiet.critical' : 'notifications.quiet.offLine')}</span>
        </div>
        <Switch name={t('notifications.quietHours')} on={shown !== null} disabled={held} onToggle={toggle} />
      </div>

      {shown ? (
        <div className={styles.times}>
          <TimeField
            label={t('notifications.quiet.from')}
            value={timeOf(shown.fromMinute)}
            locked={locked}
            onCommit={minute => set('fromMinute', minute)}
          />
          <TimeField
            label={t('notifications.quiet.to')}
            value={timeOf(shown.toMinute)}
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
