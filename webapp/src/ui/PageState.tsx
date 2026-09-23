import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchedAt } from '@/api/clock';
import { ApiError } from '@/api/problem';
import { ageLabel } from './age';
import ui from './ui.module.css';
import styles from './PageState.module.css';

/**
 * What the server said when it refused, under the control that asked.
 *
 * Every refusal arrives as a problem document with a sentence in it written for
 * the person rather than for the client, so that sentence is what is shown; the
 * code behind it is for the screens that can offer a way out of one particular
 * refusal, and they read it themselves. A problem terse enough to carry no
 * sentence still carries its title, which is a better answer than a stock one.
 *
 * Anything that is not a problem document never reached the server at all - a
 * dropped connection, a request that timed out - and is said as that. It is a
 * write that was refused rather than a page that would not load, so it offers
 * the same tap again rather than a gesture.
 */
export function Refused({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;

  return (
    <p className={ui.problem} role="alert">
      {error instanceof ApiError ? error.problem.detail || error.problem.title : t('shell.unreachable')}
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
export type Subject = 'space' | 'grow' | 'camera' | 'device';

/**
 * A page whose subject the server says is not there for this account.
 *
 * It is the one failure that is not worth trying again, and the reason it
 * happens is almost always another person: somebody was taken out of a tent
 * they were standing in, and every read behind the page they are looking at
 * has been answering 404 ever since. Drawn as an ordinary load failure it
 * reads as a broken app and leaves them tapping a button that can never work,
 * so it says what is true - this is not yours to see - and offers the only
 * move that leads anywhere, which is home.
 *
 * It does not claim to know *why*, because the server does not say: a tent
 * that ended and a bookmark to an id that never existed answer the same 404,
 * and both are honestly described by the same sentence.
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
 * nothing removed.
 *
 * The instant is the one this browser noted as the read came back, while `now`
 * is the server's, so it is restated on the server's clock before the two are
 * subtracted. The age itself is the same either way - the offset cancels - but
 * mixing the two clocks would date the failure by however far they differ.
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
