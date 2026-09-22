import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './parts.module.css';

/**
 * What every page below Me is built from: the page with its title and the
 * trail back, and the setting row.
 *
 * The privacy and notification pages drew these first and each carries its
 * own copy; the four pages that arrived with round 14 share this one instead,
 * so that a row on Appearance and a row on Account are the same row and not
 * two that drifted. They are deliberately the same shapes, to the pixel: a
 * person walking from one page to the next should not be able to tell where
 * one slice of the work ended and another began.
 */

/** The page: its title, and on a width that has room for it the trail back to Me. */
export function MePage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <span className={`mono ${styles.crumb}`}>
          <Link to="/me">{t('me.title')}</Link> › {title}
        </span>
      </header>
      {children}
    </section>
  );
}

/**
 * A setting: what it is, one line saying what it does or what it says today,
 * and the control at the right. What a control opens - a form, a question, a
 * list - goes underneath, inside the same card, so that the column at rest
 * reads as a list of equal things.
 */
export function Row({
  title,
  line,
  danger,
  children,
  below,
}: {
  title: string;
  line: ReactNode;
  danger?: boolean;
  /** The control at the right. */
  children?: ReactNode;
  /** What the control opened, under the head. */
  below?: ReactNode;
}) {
  return (
    <div className={`${ui.card} ${styles.row}`} data-danger={danger ? '' : undefined}>
      <div className={styles.rowHead}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          <span className={`${ui.note} ${styles.rowLine}`}>{line}</span>
        </div>
        {children ? <div className={styles.rowControl}>{children}</div> : null}
      </div>
      {below}
    </div>
  );
}

/**
 * A chip that is a menu: the native select, keeping its keyboard and the
 * platform's own picker, giving up only its arrow and its padding. The options
 * are the caller's, because a menu of units and a menu of languages have
 * nothing in common but the shape.
 */
export function Menu({
  name,
  value,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      className={`mono ${ui.chip} ${styles.menu}`}
      value={value}
      aria-label={name}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}
