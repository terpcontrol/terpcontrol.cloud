import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { ageLabel } from './age';
import ui from './ui.module.css';
import styles from './PageState.module.css';

/** What went wrong when a page has nothing to show yet, with the way to try again. */
export function LoadFailed({ retry }: { retry: () => void }) {
  const { t } = useTranslation();

  return (
    <section className={styles.failed}>
      <p className={ui.problem} role="alert">
        {t('shell.loadFailed')}
      </p>
      <button type="button" className={ui.button} onClick={retry}>
        {t('home.retry')}
      </button>
    </section>
  );
}

/** A refresh that failed while the page still shows what it knew: one line, and nothing removed. */
export function RefreshFailed({ failedAt, now }: { failedAt: number | null; now: DateTime }) {
  const { t } = useTranslation();
  if (!failedAt) return null;

  return (
    <p className={`mono ${styles.refreshFailed}`} role="status">
      {t('home.refreshFailed', { age: ageLabel(new Date(failedAt).toISOString(), now) })}
    </p>
  );
}

/** A block in the shape of what is coming, saying that it is. */
export function Waiting({ lines = 3 }: { lines?: number }) {
  const { t } = useTranslation();

  return (
    <div className={`${ui.card} ${styles.waiting}`} aria-busy="true">
      <span className={`mono ${styles.waitingNote}`}>{t('home.waiting')}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={styles.waitingLine} style={{ width: `${70 - index * 15}%` }} />
      ))}
    </div>
  );
}
