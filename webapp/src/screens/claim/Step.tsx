import { Check } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import styles from './Claim.module.css';

/**
 * One of the four numbered steps of the claim flow.
 *
 * Only one is ever open, and the other three still say what they are for: a
 * step that has been done reads as what it settled - "Claimed · Terp Controller
 * · 7F3A" - and one still ahead reads as the question it will ask. That is the
 * whole point of drawing them all at once rather than one screen at a time.
 * Somebody who stops after the first two can see what they left, and what they
 * left is not lost: every step can also be done later from the ordinary screens.
 *
 * A step already settled stays reachable through its own heading, because the
 * wrong tent gets named first far more often than the right one does.
 *
 * The heading of the open step is where keyboard focus is put when a step
 * settles, so it can be reached from outside: the question is read before the
 * field, and a phone does not raise its keyboard while somebody is still
 * holding the hardware.
 */
export function Step({
  number,
  state,
  title,
  text,
  onOpen,
  headingRef,
  children,
}: {
  number: number;
  state: 'done' | 'open' | 'ahead';
  /** The header line: the question while the step is open, what it settled once it is done. */
  title: ReactNode;
  text: ReactNode;
  onOpen: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children?: ReactNode;
}) {
  const open = state === 'open';

  return (
    <section className={styles.step} data-state={state} aria-current={open ? 'step' : undefined}>
      <span className={`mono ${styles.marker}`} data-state={state} aria-hidden>
        {state === 'done' ? <Check size={14} strokeWidth={2.5} /> : number}
      </span>

      <div className={styles.stepBody}>
        <h2 className={styles.stepTitle} ref={headingRef} tabIndex={open ? -1 : undefined}>
          {state === 'done' ? (
            <button type="button" className={styles.reopen} onClick={onOpen}>
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <p className={styles.stepText}>{text}</p>
        {open ? <div className={styles.stepFields}>{children}</div> : null}
      </div>
    </section>
  );
}
