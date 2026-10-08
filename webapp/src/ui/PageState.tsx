import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchedAt } from '@/api/clock';
import { ageLabel } from './age';
import ui from './ui.module.css';
import styles from './PageState.module.css';
import { refusalText } from '@/ui/refusal';

/**
 * What the server said when it refused, under the control that asked: the
 * problem's sentence for an English reader, the catalogue's words for anybody
 * else. Anything that is not a problem never reached the server and is said as
 * that, offering the same tap again - in the caller's `fallback` where it can
 * say what was being tried.
 */
export function Refused({ error, fallback, className }: { error: unknown; fallback?: string; className?: string }) {
  // Subscribed so the sentence is written again when the language changes.
  useTranslation();
  if (!error) return null;

  return (
    <p className={className ? `${ui.problem} ${className}` : ui.problem} role="alert">
      {refusalText(error, fallback)}
    </p>
  );
}

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

/** The four things a page can be about that somebody can stop being able to reach. */
type Subject = 'space' | 'grow' | 'camera' | 'device';

/**
 * A page whose subject the server says is not there for this account - usually
 * because somebody was taken out of a tent. It is not worth trying again, so it
 * offers home, and names only the two causes a 404 can have: it does not say the
 * subject ended, nor name a sharer, since a 404 does not tell which ids exist.
 */
export function NoLongerHere({ what }: { what: Subject }) {
  const { t } = useTranslation();

  return (
    <section className={styles.failed}>
      <p className={ui.problem} role="alert">
        {t(`shell.gone.${what}`)}
      </p>
      <p className={ui.note}>{t('shell.gone.why')}</p>
      <Link to="/" className={ui.button}>
        {t('shell.gone.home')}
      </Link>
    </section>
  );
}

/**
 * A refresh that failed while the page still shows what it knew: one line, and
 * nothing removed. The failure was noted on this browser's clock and `now` is
 * the server's, so it is restated on the server's before the two are subtracted.
 */
export function RefreshFailed({ failedAt, now }: { failedAt: number | null; now: DateTime }) {
  const { t } = useTranslation();
  if (!failedAt) return null;

  return (
    <p className={`mono ${styles.refreshFailed}`} role="status">
      {t('home.refreshFailed', { age: ageLabel(fetchedAt(failedAt), now) })}
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
