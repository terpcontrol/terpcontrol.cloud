import { Check } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import styles from './Claim.module.css';

/**
 * One of the numbered steps of the claim flow.
 *
 * Only one is ever open, and the others still say what they are for: a step
 * that has been done reads as what it settled - "Claimed · Terp Controller" -
 * and one still ahead as the question it will ask. That is the point of
 * drawing them all at once: somebody who stops after the first two can see
 * what they left, and every step can also be done later from the ordinary
 * screens.
 *
 * A settled step stays reachable through its heading where it can be answered
 * again. What a question is about stands behind the help button in its corner,
 * never as a paragraph under it. The heading of the open step is where focus
 * is put when it opens: the question is read before the field, and a phone
 * does not raise its keyboard while somebody is still holding the hardware.
 */
export function Step({
  number,
  state,
  title,
  help,
  text,
  onOpen,
  headingRef,
  children,
}: {
  number: number;
  state: 'done' | 'open' | 'ahead';
  /** The header line: the question while the step is open, what it settled once it is done. */
  title: ReactNode;
  help?: HelpTopic;
  /** What the step settled, or what stands on it now; nothing for a question nobody answered yet. */
  text?: ReactNode;
  /** Opens a settled step again; absent where there is nothing to answer a second time. */
  onOpen?: () => void;
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
        <div className={styles.stepHead}>
          <h2 className={styles.stepTitle} ref={open ? headingRef : undefined} tabIndex={open ? -1 : undefined}>
            {state === 'done' && onOpen ? (
              <button type="button" className={styles.reopen} onClick={onOpen}>
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          {open && help ? <Help topic={help} /> : null}
        </div>
        {text ? <p className={styles.stepText}>{text}</p> : null}
        {open ? <div className={styles.stepFields}>{children}</div> : null}
      </div>
    </section>
  );
}
