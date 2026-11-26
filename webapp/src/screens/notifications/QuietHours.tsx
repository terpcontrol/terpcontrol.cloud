import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me, QuietHours } from '@fg2/shared-types/v1';
import { Refused } from '@/ui/PageState';
import { Row } from '@/screens/me/parts';
import parts from '@/screens/me/parts.module.css';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
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
 * Both ends are one window and are written as one: a settings write carries
 * the whole account, so a second write built on what the account still says
 * would put back the end that was moved first. The card therefore holds the
 * window it means - its title says it as it is typed - and writes it whole: a
 * moment after the last change, at once when a field is left, and when the
 * page is, so a time typed before Back is not lost. A time field hands over a
 * whole time after every keystroke - the "2" of 23:00 makes it 02:00 - so no
 * change is written as it arrives, and the fields are never held still while
 * a write is on its way. The draft is dropped once the account agrees; a
 * refused window stays beside the refusal, and one of no length is not sent.
 */
export function QuietHoursCard({ me, held, locked }: { me: Me; held: boolean; locked: boolean }) {
  const { t } = useTranslation();
  const { write, error } = useWriteNotifications(me);
  const quiet = me.notifications.quietHours;
  const [wanted, setWanted] = useState<QuietHours | null>(null);
  /** The draft a write was made of, so that leaving a field after the pause does not send it twice. */
  const [sent, setSent] = useState<QuietHours | null>(null);

  // The account has caught up with what was asked for, so there is nothing left to hold.
  if (wanted && sameWindow(wanted, quiet)) {
    setWanted(null);
    setSent(null);
  }

  const shown = wanted ?? quiet;
  const empty = wanted !== null && wanted.fromMinute === wanted.toMinute;
  // Beside a window that is refused the title keeps the saved one.
  const titled = empty ? quiet : shown;

  const said = (window: QuietHours | null) =>
    window
      ? t('notifications.told.quiet', { from: timeOf(window.fromMinute), to: timeOf(window.toMinute) })
      : t('notifications.told.off', { what: t('notifications.quietHours') });
  const answer = (window: QuietHours | null) => write({ quietHours: window }, said(window), said(quiet));
  const save = () => {
    if (!wanted || empty || sameWindow(wanted, sent)) return;
    setSent(wanted);
    answer(wanted);
  };
  const toggle = () => {
    setWanted(null);
    setSent(null);
    answer(shown ? null : DEFAULT_QUIET);
  };
  const saveAsItStands = useEffectEvent(save);

  // Another write on its way would be carried back by this one, so the pause starts once that has landed.
  useEffect(() => {
    if (!wanted || held) return;
    const timer = window.setTimeout(saveAsItStands, 1200);
    return () => window.clearTimeout(timer);
  }, [wanted, held]);
  useEffect(() => () => saveAsItStands(), []);

  const field = (end: 'fromMinute' | 'toMinute', label: string) => (
    <TimeField
      label={label}
      value={timeOf(shown![end])}
      locked={locked}
      onChange={minute => setWanted({ ...shown!, [end]: minute })}
      onLeave={() => (held ? undefined : save())}
    />
  );

  return (
    <Row
      title={
        titled ? t('notifications.quiet.window', { from: timeOf(titled.fromMinute), to: timeOf(titled.toMinute) }) : t('notifications.quiet.offTitle')
      }
      line={t(shown ? 'notifications.quiet.critical' : 'notifications.quiet.offLine')}
      below={
        <>
          {shown ? (
            <div className={styles.times}>
              {field('fromMinute', t('notifications.quiet.from'))}
              {field('toMinute', t('notifications.quiet.to'))}
            </div>
          ) : null}
          {empty ? (
            <p className={ui.problem} role="alert">
              {t('notifications.quiet.empty')}
            </p>
          ) : null}
          <p className={ui.note}>{t('notifications.quiet.zone', { zone: me.preferences.timezone })}</p>
          <Refused error={error} />
        </>
      }
    >
      <Switch label={t('notifications.quietHours')} on={shown !== null} disabled={held} onChange={toggle} />
    </Row>
  );
}

type Field = { label: string; value: string; locked: boolean; onChange: (minute: number) => void; onLeave: () => void };

/** One end of the window, held as text: while it is typed into it can hold no time at all, and left so it says the window's again. */
function TimeField({ label, value, locked, onChange, onLeave }: Field) {
  const [text, setText] = useState(value);
  const [said, setSaid] = useState(value);

  // The window has moved - typed here, landed, taken back - so the field says it again.
  if (said !== value) {
    setSaid(value);
    setText(value);
  }

  return (
    <label className={parts.field}>
      <span className="label">{label}</span>
      <input
        className={ui.input}
        type="time"
        value={text}
        disabled={locked}
        onChange={event => {
          const minute = minuteOf(event.target.value);
          setText(event.target.value);
          if (minute !== null) onChange(minute);
        }}
        onBlur={() => {
          setText(value);
          onLeave();
        }}
      />
    </label>
  );
}
