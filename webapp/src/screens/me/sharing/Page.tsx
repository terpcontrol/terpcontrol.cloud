import type { ReactNode } from 'react';
import { MePage } from '../parts';
import styles from './sharing.module.css';

/**
 * The frame the three pages share, which is the frame every page below Me
 * shares: it was drawn twice for a while and the copy here lost the way back a
 * phone needs, because a trail of words is not something a thumb finds. There
 * is one frame now and this is the name these three screens call it by.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return <MePage title={title}>{children}</MePage>;
}

/** A small-caps label over a block, with the figure the board puts opposite it. */
export function SectionHead({ label, count }: { label: string; count?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <span className="label">{label}</span>
      {count === undefined ? null : <span className={`mono ${styles.count}`}>{count}</span>}
    </div>
  );
}
