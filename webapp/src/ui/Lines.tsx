import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry } from '@fg2/shared-types/v1';
import styles from './Lines.module.css';
import ui from './ui.module.css';

/**
 * Lines of a diary in summary: when in one column as wide as its longest
 * stamp, what happened beside it. Start's last lines and a day of the diary
 * are both this list.
 */
export function Lines({ children }: { children: ReactNode }) {
  return <ul className={styles.lines}>{children}</ul>;
}

/**
 * One line: its stamp, its words, and at its end what marks it - that a
 * device did it by itself. The words are the way into the line where the
 * surface offers one: a sheet that corrects it (`onOpen`, named by `opens`),
 * or the page it leads to (`to`).
 */
export function Line({
  stamp,
  children,
  mark = null,
  severity = null,
  onOpen,
  opens,
  to,
}: {
  stamp: string;
  children: ReactNode;
  mark?: string | null;
  severity?: Entry['severity'];
  onOpen?: (() => void) | null;
  /** What opening the line does, for the tooltip and a screen reader; correcting it where nothing else is said. */
  opens?: string;
  to?: string | null;
}) {
  const { t } = useTranslation();
  const does = opens ?? t('grow.correctLine');

  return (
    <li className={styles.line} data-severity={severity ?? undefined}>
      <span className={styles.stamp}>{stamp}</span>
      {to ? (
        <Link to={to} className={styles.text}>
          {children}
          <span aria-hidden> ›</span>
        </Link>
      ) : onOpen ? (
        <button type="button" className={styles.text} title={does} onClick={onOpen}>
          {children}
          <span className={ui.visuallyHidden}>{`, ${does}`}</span>
        </button>
      ) : (
        <span className={styles.text}>{children}</span>
      )}
      {mark ? <span className={styles.mark}>{mark}</span> : null}
    </li>
  );
}
