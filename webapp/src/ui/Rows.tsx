import { ChevronRight } from 'lucide-react';
import { Children, isValidElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './Rows.module.css';

/**
 * Rows that open something - a page, a sheet - or do the one thing they name:
 * the title, under it a line that says what is behind it, and "›" where the
 * row leads somewhere. `Rows` is the card holding a list of them; a row on its
 * own (`alone`) is its own card. Every row is a finger high.
 */
export function Rows({
  label,
  grid = false,
  children,
}: {
  label?: string;
  /** Beside the rail the rows stand two by two, each a card of its own. */
  grid?: boolean;
  children: ReactNode;
}) {
  return (
    <ul className={styles.rows} aria-label={label} data-grid={grid || undefined}>
      {Children.toArray(children).map((child, index) => (
        <li key={isValidElement(child) ? (child.key ?? index) : index}>{child}</li>
      ))}
    </ul>
  );
}

interface RowProps {
  title: ReactNode;
  line?: ReactNode;
  /** The line in amber: something behind the row needs a person. */
  warn?: boolean;
  to?: string;
  /** What the page the row leads to is told, such as the way back. */
  state?: unknown;
  onOpen?: () => void;
  /** What stands before the title: a camera's picture. */
  lead?: ReactNode;
  alone?: boolean;
  /** Not now, the line saying why: drawn, read out as unavailable and deaf to a tap. */
  waits?: boolean;
  /** A row that does what it names instead of opening something has no chevron. */
  acts?: boolean;
}

export function Row({ title, line = null, warn = false, to, state, onOpen, lead = null, alone = false, waits = false, acts = false }: RowProps) {
  const className = alone ? `${styles.row} ${styles.alone}` : styles.row;
  const inside = (
    <>
      {lead}
      <span className={styles.text}>
        {title}
        {line ? (
          <span className={styles.line} data-tone={warn ? 'warn' : undefined}>
            {line}
          </span>
        ) : null}
      </span>
      {waits || acts ? null : <ChevronRight className={styles.chevron} size={20} strokeWidth={2} aria-hidden />}
    </>
  );

  return to ? (
    <Link className={className} to={to} state={state}>
      {inside}
    </Link>
  ) : (
    <button type="button" className={className} aria-disabled={waits || undefined} onClick={waits ? undefined : onOpen}>
      {inside}
    </button>
  );
}
