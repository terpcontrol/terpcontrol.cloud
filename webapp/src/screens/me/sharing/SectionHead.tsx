import type { ReactNode } from 'react';
import styles from './sharing.module.css';

/** A small-caps label over a block, with the figure the board puts opposite it. */
export function SectionHead({ label, count }: { label: string; count?: ReactNode }) {
  return (
    <header className={styles.sectionHead}>
      <span className="label">{label}</span>
      {count === undefined ? null : <span className={`mono ${styles.count}`}>{count}</span>}
    </header>
  );
}
