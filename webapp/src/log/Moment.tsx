import { Pencil } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import type { Translate } from '@/i18n/i18n';
import { clockOf, dayOf, momentAt } from '@/ui/days';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { CLOCK, DATED_CLOCK, DATED_CLOCK_WITH_YEAR, nowThere, useZone, zonedAt } from '@/ui/zone';
import styles from './Moment.module.css';

/**
 * When a diary line happened, in the corner of the sheet it is written in.
 *
 * Every line can be dated, and the date is on screen from the start rather
 * than behind a long press: "heute · 14:32" is what a line left alone says, and
 * a tap on it - or on the pencil beside it - opens a small pop-up with the day
 * and the time. The line is about something that has happened, so nothing after
 * now is accepted; changing only the day keeps the time that was there.
 *
 * `fixed` shows the moment without offering to change it, for the one line
 * whose effect starts when it is saved: maintenance parks the hardware now,
 * whatever day it would be dated to.
 */
export function Moment({ at, onChange, fixed }: { at: Date | null; onChange: (at: Date) => void; fixed?: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const id = useId();
  const frame = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');

  // A line nobody dated is "now", and stays now while the sheet is open.
  const shown = at ?? now.toJSDate();
  const label = fixed ? t('log.now') : momentLabel(t, shown, now, zone);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  if (fixed) return <span className={`mono ${styles.fixed}`}>{label}</span>;

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const take = (next: Date) => {
    onChange(next);
    close();
  };

  const today = dayOf(serverNow().toJSDate(), zone);
  const chosen = momentAt(day, time, zone);
  const ahead = chosen !== null && chosen.getTime() > serverNow().toMillis();

  return (
    <div
      className={styles.moment}
      ref={frame}
      onKeyDown={event => {
        // Escape puts the pop-up away and leaves the sheet under it open.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        close();
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={`mono ${styles.button}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('log.moment.change', { when: label })}
        onClick={() => {
          if (open) return close();
          setDay(dayOf(shown, zone));
          setTime(clockOf(shown, zone));
          setOpen(true);
        }}
      >
        {label}
        <Pencil size={13} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div className={styles.popover} id={id} role="group" aria-label={t('log.moment.title')}>
          <label className={styles.field}>
            <span className="label">{t('log.moment.day')}</span>
            <input
              ref={first}
              className={`mono ${ui.input}`}
              type="date"
              max={today}
              value={day}
              onChange={event => event.target.value && setDay(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className="label">{t('log.moment.time')}</span>
            <input
              className={`mono ${ui.input}`}
              type="time"
              max={day === today ? clockOf(serverNow().toJSDate(), zone) : undefined}
              value={time}
              onChange={event => event.target.value && setTime(event.target.value)}
            />
          </label>
          {ahead ? (
            <p className={ui.problem} role="alert">
              {t('log.moment.ahead')}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={ui.button} onClick={() => take(serverNow().toJSDate())}>
              {t('log.moment.now')}
            </button>
            <button type="button" className={`${ui.button} ${ui.primary}`} disabled={chosen === null || ahead} onClick={() => chosen && take(chosen)}>
              {t('log.moment.apply')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "heute · 14:32", "gestern · 21:05", "13. Okt 09:15": the day in words while it is near, the date once it is not. */
const momentLabel = (t: Translate, at: Date, now: DateTime, zone: string | null): string => {
  const there = zonedAt(at.getTime(), zone);
  const today = nowThere(now, zone);
  const time = there.toFormat(CLOCK);

  if (there.hasSame(today, 'day')) return t('log.moment.today', { time });
  if (there.hasSame(today.minus({ days: 1 }), 'day')) return t('log.moment.yesterday', { time });
  return there.toFormat(there.hasSame(today, 'year') ? DATED_CLOCK : DATED_CLOCK_WITH_YEAR);
};
