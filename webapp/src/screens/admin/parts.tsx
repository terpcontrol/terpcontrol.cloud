import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchedAt } from '@/api/clock';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './Admin.module.css';

/**
 * The head of an admin screen: its title, a pill that says how old the
 * screen's read is - the fleet moves while it is looked at, and nothing else
 * on the screen dates it -, the trail back to the fleet ending in `crumb` on
 * every screen below it, and whatever the screen counts and filters by.
 */
export function AdminHead({
  title,
  crumb,
  readAt = 0,
  children,
}: {
  title: string;
  crumb?: ReactNode;
  /** When the screen's own read last answered (`dataUpdatedAt`); nothing is dated before it has. */
  readAt?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const now = useNow();
  // The read's instant is the browser's; it is aged on the server's clock like every other age.
  const at = readAt > 0 ? fetchedAt(readAt) : null;

  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      {at ? (
        <span className={ui.live} data-liveness={deviceLiveness(at, now)}>
          {t('admin.asOf', { age: ageLabel(at, now) })}
        </span>
      ) : null}
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
export function AdminNotLoaded({ head, lines = 4, retry }: { head: ReactNode; lines?: number; retry?: () => void }) {
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
