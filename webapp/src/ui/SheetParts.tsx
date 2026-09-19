import type { ReactNode } from 'react';
import { dayOf, momentOn } from './days';
import ui from './ui.module.css';
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
 * Tuesday would run the day counter into the future.
 */
export function WhenField({ label, at, onChange }: { label: string; at: Date; onChange: (at: Date) => void }) {
  return (
    <label className={`${ui.card} ${styles.when}`}>
      <span className={styles.whenLabel}>{label}</span>
      <input
        className={`mono ${styles.whenInput}`}
        type="date"
        max={dayOf(new Date())}
        value={dayOf(at)}
        onChange={event => event.target.value && onChange(momentOn(event.target.value, at))}
      />
    </label>
  );
}

/** A labelled block inside a sheet, so that a long sheet reads as the few questions it is. */
export function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <header className={styles.blockHeader}>
        <span className="label">{label}</span>
        {aside ? <span className={`mono ${styles.blockAside}`}>{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}
