import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import styles from './sharing.module.css';

/**
 * The frame the three pages share: the title, the trail back to Me, and the
 * column under them. It is the frame Privacy draws for itself, kept here once
 * so that three screens about the same subject - what other people can see -
 * cannot drift apart from each other or from it.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
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

/** A small-caps label over a block, with the figure the board puts opposite it. */
export function SectionHead({ label, count }: { label: string; count?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <span className="label">{label}</span>
      {count === undefined ? null : <span className={`mono ${styles.count}`}>{count}</span>}
    </div>
  );
}
