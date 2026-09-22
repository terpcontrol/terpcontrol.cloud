import type { ReactNode } from 'react';
import ui from '@/ui/ui.module.css';
import styles from './Privacy.module.css';

/**
 * A setting: what it is, one line saying what it does, and the control at the
 * right. Every row on the screen is this shape, so the column reads as a list
 * of promises rather than as a form - which is what the board draws, and what
 * a setting that is answered by a switch, a menu or a button all have in common.
 */
export function Row({ title, line, danger, children }: { title: string; line: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <div className={`${ui.card} ${styles.row}`} data-danger={danger ? '' : undefined}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={`${ui.note} ${styles.rowLine}`}>{line}</span>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** The app's one switch, on a setting. */
export function Switch({ name, on, disabled, onToggle }: { name: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label={name} disabled={disabled} onClick={onToggle}>
      <span className={ui.knob} aria-hidden />
    </button>
  );
}
