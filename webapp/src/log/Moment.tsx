import { Pencil } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import type { Translate } from '@/i18n/i18n';
import { clockOf, dayOf, momentAt } from '@/ui/days';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { CLOCK, DATED_CLOCK, DATED_CLOCK_WITH_YEAR, DAY, nowThere, useZone, zonedAt } from '@/ui/zone';
import styles from './Moment.module.css';

/**
 * When a diary line happened, in the corner of the sheet it is written in.
 *
 * Every line can be dated, and the date is on screen from the start rather
 * than behind a long press: "heute · 14:32" is what a line left alone says, and
 * a tap on it - or on the pencil beside it - opens a small pop-up with the day
 * and the time. The line is about something that has happened, so nothing after
 * now is accepted; changing only the day keeps the time that was there. A
 * moment the pop-up refuses is answered there - with another, with now, or by
 * closing it - before anything else on the sheet is: a tap beside it does not
 * put the question away.
 *
 * `row` is the same control where the moment is asked before the kind of
 * line: a row across the sheet, the question and its answer left and "Ändern"
 * right.
 */
/** Where the grow a line is about began, and how its start is moved there by somebody who may. */
export interface MomentBegins {
  at: Date;
  move: ((to: Date) => Promise<unknown>) | null;
}

export function Moment({
  at,
  onChange,
  row = false,
  begins = null,
  onRefused,
}: {
  at: Date | null;
  onChange: (at: Date) => void;
  row?: boolean;
  /**
   * For a line about a grow: where the date the grow began on begins, before
   * which a line has no day to stand under - and how the grow's start is moved
   * there, for somebody who may.
   */
  begins?: MomentBegins | null;
  /**
   * Told while the pop-up stands open on a moment it refuses - one still to
   * come, one before the grow began: the sheet around it does not save then,
   * since its line would be filed under a moment nobody chose.
   */
  onRefused?: (refused: boolean) => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const id = useId();
  const frame = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [moving, setMoving] = useState<'busy' | 'refused' | null>(null);

  // A line nobody dated is "now", and stays now while the sheet is open.
  const shown = at ?? now.toJSDate();
  const label = momentLabel(t, shown, now, zone);
  const today = dayOf(serverNow().toJSDate(), zone);
  const chosen = momentAt(day, time, zone);
  const ahead = chosen !== null && chosen.getTime() > serverNow().toMillis();
  const before = chosen !== null && begins !== null && chosen < begins.at;
  /** What the pop-up says beside its fields, which is what makes it taller. */
  const notices = `${ahead}${before}${moving}`;
  const refused = open && (ahead || before);
  useEffect(() => onRefused?.(refused), [refused, onRefused]);

  // Placed against the window rather than inside the sheet, whose edge would
  // cut it off: under the moment where the sheet has room for it, over it
  // where it has not - a short sheet's bottom is where the Log button stands.
  useLayoutEffect(() => {
    if (!open) return;
    const placeIt = () => {
      const button = toggle.current?.getBoundingClientRect();
      const height = popover.current?.offsetHeight ?? 0;
      const sheet = frame.current?.closest('[role="dialog"]');
      if (!button || !sheet) return;
      const floor = sheet.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sheet).paddingBottom);
      const below = button.bottom + GAP + height <= floor;
      // Never past the window's edge either way: what it says about a grow's start makes it taller than a short screen has room for under the moment.
      const lowest = document.documentElement.clientHeight - GAP - height;
      setPlace({
        right: Math.max(GAP, document.documentElement.clientWidth - button.right),
        top: Math.max(GAP, Math.min(below ? button.bottom + GAP : button.top - GAP - height, lowest)),
      });
    };
    placeIt();
    window.addEventListener('resize', placeIt);
    return () => window.removeEventListener('resize', placeIt);
    // Placed again when what it says changes its height.
  }, [open, notices]);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (event: PointerEvent) => {
      if (!refused && !frame.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, refused]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const take = (next: Date) => {
    onChange(next);
    close();
  };

  const moveStart = () => {
    if (!chosen || !begins?.move) return;
    setMoving('busy');
    begins.move(chosen).then(
      () => {
        setMoving(null);
        take(chosen);
      },
      () => setMoving('refused'),
    );
  };

  return (
    <div
      className={row ? styles.row : styles.moment}
      ref={frame}
      onKeyDown={event => {
        // Escape puts the pop-up away and leaves the sheet under it open.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        close();
      }}
    >
      {row ? (
        <span className={styles.asked}>
          {t('log.moment.title')}
          <span className={styles.answer}>{label}</span>
        </span>
      ) : null}
      <button
        ref={toggle}
        type="button"
        className={row ? `${ui.pill} ${styles.change}` : styles.button}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('log.moment.change', { when: label })}
        onClick={() => {
          if (open) return close();
          setDay(dayOf(shown, zone));
          setTime(clockOf(shown, zone));
          setPlace({ visibility: 'hidden' });
          setOpen(true);
        }}
      >
        {row ? (
          t('log.moment.edit')
        ) : (
          <>
            {label}
            <Pencil size={13} strokeWidth={2} aria-hidden />
          </>
        )}
      </button>
      {open ? (
        <div ref={popover} className={styles.popover} style={place} id={id} role="group" aria-label={t('log.moment.title')}>
          <label className={ui.stack1}>
            <span className="label">{t('log.moment.day')}</span>
            <input
              ref={first}
              className={ui.input}
              type="date"
              max={today}
              value={day}
              onChange={event => event.target.value && setDay(event.target.value)}
            />
          </label>
          <label className={ui.stack1}>
            <span className="label">{t('log.moment.time')}</span>
            <input
              className={ui.input}
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
          {before && begins ? (
            <>
              {/* A line about a grow stands under one of its days, and there is none before the first. */}
              <p className={ui.note} role="status">
                {t('log.moment.before', { date: zonedAt(begins.at.getTime(), zone).toFormat(DAY) })}
              </p>
              {begins.move ? (
                <button type="button" className={`${ui.button} ${styles.move}`} disabled={moving === 'busy'} onClick={moveStart}>
                  {t('log.moment.moveStart', { date: zonedAt(chosen.getTime(), zone).toFormat(DAY) })}
                </button>
              ) : null}
              {moving === 'refused' ? (
                <p className={ui.problem} role="alert">
                  {t('log.moment.moveRefused')}
                </p>
              ) : null}
            </>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={ui.button} onClick={() => take(serverNow().toJSDate())}>
              {t('log.moment.now')}
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={chosen === null || ahead || before}
              onClick={() => chosen && take(chosen)}
            >
              {t('log.moment.apply')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The room between the pop-up, the moment it belongs to and the window's edge. */
const GAP = 4;

/** "heute · 14:32", "gestern · 21:05", "13. Okt 09:15": the day in words while it is near, the date once it is not. */
const momentLabel = (t: Translate, at: Date, now: DateTime, zone: string | null): string => {
  const there = zonedAt(at.getTime(), zone);
  const today = nowThere(now, zone);
  const time = there.toFormat(CLOCK);

  if (there.hasSame(today, 'day')) return t('log.moment.today', { time });
  if (there.hasSame(today.minus({ days: 1 }), 'day')) return t('log.moment.yesterday', { time });
  return there.toFormat(there.hasSame(today, 'year') ? DATED_CLOCK : DATED_CLOCK_WITH_YEAR);
};
