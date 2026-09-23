import type { ReactNode } from 'react';
import { serverNow } from '@/api/clock';
import { dayOf, momentOn } from './days';
import ui from './ui.module.css';
import { useZone } from './zone';
import styles from './SheetParts.module.css';

/**
 * The three controls every sheet that records something is built from: a row of
 * things to pick one of, the day it happened, and a label over a block.
 *
 * They are here rather than on a screen because a phase, a move, a harvest and
 * a climate preset all ask the same two questions - which one, and when - and
 * a second row of chips that behaved differently would be a second answer to
 * what "chosen" looks like.
 */

/** A row of chips, one of which is the answer. Wraps, because a row of plants is as long as the grow is. */
export function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.choices} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function Choice({ chosen, onChoose, disabled, children }: { chosen: boolean; onChoose: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`${ui.chip} ${styles.choice}`} data-chosen={chosen} aria-pressed={chosen} disabled={disabled} onClick={onChoose}>
      {children}
    </button>
  );
}

/**
 * When it happened. Dated rather than timed, and never later than today: these
 * sheets record what has already been done, and a phase entered for next
 * Tuesday would run the day counter into the future. Which day is today is the
 * server's answer, because it is the server that will refuse an instant in its
 * own future.
 *
 * Which day that is, is the account's answer: a grow day is a day where the
 * tent stands, so a reader whose browser has already turned over picks from
 * their own tomorrow and dates a phase a day before the one they meant. The
 * zone is read here rather than handed down, because six sheets draw this one
 * field and two answers to "which day is it" is exactly what that would buy.
 */
export function WhenField({ label, at, onChange }: { label: string; at: Date; onChange: (at: Date) => void }) {
  const zone = useZone();

  return (
    <label className={`${ui.card} ${styles.when}`}>
      <span className={styles.whenLabel}>{label}</span>
      <input
        className={`mono ${styles.whenInput}`}
        type="date"
        max={dayOf(serverNow().toJSDate(), zone)}
        value={dayOf(at, zone)}
        onChange={event => event.target.value && onChange(momentOn(event.target.value, at, zone))}
      />
    </label>
  );
}

/**
 * A labelled block inside a sheet, so that a long sheet reads as the few
 * questions it is.
 *
 * The aside is set in the text face and left there: it carries a count as
 * often as it carries a sentence of advice, and mono belongs to the figures.
 * A caller whose aside really is a figure or a caption wraps it in `mono`
 * itself, which is the one place that knows which of the two it has.
 */
export function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <header className={styles.blockHeader}>
        <span className="label">{label}</span>
        {aside ? <span className={styles.blockAside}>{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}
