import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LoadFailed, Waiting } from '@/ui/PageState';
import styles from './Admin.module.css';

/**
 * The head of an admin screen: its title, the trail back to the fleet ending
 * in `crumb` on every screen below it, and whatever the screen counts and
 * filters by.
 */
export function AdminHead({ title, crumb, children }: { title: string; crumb?: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      {crumb ? (
        <span className={`mono ${styles.crumb}`}>
          <Link to="/admin/fleet">{t('admin.fleet.title')}</Link> › {crumb}
        </span>
      ) : null}
      {children}
    </header>
  );
}

/** An admin screen with nothing to show yet: its head over the waiting block, or over the way to try again once the read has failed. */
export function AdminWaiting({ head, lines = 4, retry }: { head: ReactNode; lines?: number; retry?: () => void }) {
  return (
    <section className={styles.page}>
      {head}
      {retry ? <LoadFailed retry={retry} /> : <Waiting lines={lines} />}
    </section>
  );
}

/** How recently something was heard from, as the coloured dot and the words beside it. */
export function Liveness({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span className={`mono ${styles.liveness}`} data-liveness={state}>
      <span className={styles.dot} aria-hidden />
      {children}
    </span>
  );
}
