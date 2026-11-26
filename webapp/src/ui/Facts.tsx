import type { ReactNode } from 'react';
import { unbroken } from './fact-text';
import styles from './Facts.module.css';

/**
 * Facts set side by side with "·" between them: "24,3 °C · 66 % · Licht 80 %".
 * Where they do not fit one line the row breaks between two facts and the
 * separator goes with the break - no line ends on "·" and none begins with one
 * - and a fact stays whole, so a figure keeps its unit and a label its value.
 * Only a fact longer than the line itself breaks inside.
 *
 * A fact may be a row of facts of its own - the day's targets, the night's -
 * which then stays together for as long as it fits a line.
 */
export function Facts({ facts, className }: { facts: readonly ReactNode[]; className?: string }) {
  const said = facts.filter(fact => fact !== null && fact !== undefined && fact !== false && fact !== '');

  return (
    <span className={className ? `${styles.facts} ${className}` : styles.facts}>
      {said.map((fact, index) => (
        // The facts of a row are a list by position: a reading and the one beside it can say the same words.
        <span key={index} className={styles.fact}>
          {/* Drawn before every fact and cut away where its fact starts a line; the spaces are for whoever reads the text. */}
          {index > 0 ? <span className={styles.dot}> · </span> : <span className={styles.dot} aria-hidden />}
          {typeof fact === 'string' ? <span>{unbroken(fact)}</span> : fact}
        </span>
      ))}
    </span>
  );
}
