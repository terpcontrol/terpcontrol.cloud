import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fetchedAt } from '@/api/clock';
import type { Read } from '@/api/read';
import { ApiError } from '@/api/problem';
import { useSteersAsLastSeen } from '@/app/shell/shape';
import { ageLabel } from './age';
import amber from './OfflineHelp.module.css';
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

/**
 * What could not be read, with the one way to try again. A page that has
 * nothing to show hands over its read and its title: the title stays, so the
 * window still says where one is, and the box says what Start says - that
 * there is no connection, which changes nothing for the tent, or that the
 * server answered with a fault, which is not the reader's connection - and
 * while it asks again the button says so. `children` is what the page still
 * knows. A part of a page that could not be read hands over only how to ask
 * again, and is one line. Only a page that shows `values` says that they come
 * back with the connection; Konto or Freigabelinks have none to wait for.
 */
export function LoadFailed({
  retry,
  read,
  title,
  values = false,
  children,
}: {
  retry?: () => void;
  read?: Read;
  title?: string;
  values?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const steering = useSteersAsLastSeen();
  if (!read) {
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
  // An answer that is a problem came from the server; anything else never got that far.
  const answered = read.error instanceof ApiError ? 'server' : 'none';
  const sentence = !steering ? 'bare' : answered === 'none' && !values ? 'steering' : 'text';

  const says = (
    <>
      <section className={amber.box} role="alert">
        <h2>{t(`shell.away.${answered}.title`)}</h2>
        {/* That the devices go on regulating is said to an account that has one, as this browser last saw it. */}
        <p>{t(`shell.away.${answered}.${sentence}`)}</p>
        <button
          type="button"
          className={styles.again}
          disabled={read.isFetching}
          aria-busy={read.isFetching || undefined}
          onClick={() => void read.refetch()}
        >
          {t(read.isFetching ? 'home.retrying' : 'home.retry')}
        </button>
      </section>
      {children}
    </>
  );

  // A page that has a head of its own to stand under hands over no title.
  return <Titled title={title}>{says}</Titled>;
}

/** A page's state under its title, so the window still says where one is; without a title, the state alone. */
function Titled({ title, children }: { title?: string; children: ReactNode }) {
  return title ? (
    <section className={`${ui.stack3} ${ui.page}`}>
      <h1>{title}</h1>
      {children}
    </section>
  ) : (
    children
  );
}

/** The four things a page can be about that somebody can stop being able to reach. */
type Subject = 'space' | 'grow' | 'camera' | 'device';

/**
 * A page whose subject the server says is not there for this account. It is
 * not worth trying again, so it offers home, and names only the two causes a
 * 404 can have: a 404 does not tell which ids exist. Its heading says what
 * the address was about and titles the window.
 */
export function NoLongerHere({ what }: { what: Subject }) {
  const { t } = useTranslation();

  return (
    <section className={styles.failed}>
      <h1>{t(`shell.gone.title.${what}`)}</h1>
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
    // No live region: the age in it changes every ten seconds, and each would be said again.
    <p className={styles.refreshFailed}>{t('home.refreshFailed', { age: ageLabel(fetchedAt(failedAt), now) })}</p>
  );
}

/** A block in the shape of what is coming, saying that it is; a page waiting for its whole read keeps its `title` over it. */
export function Waiting({ lines = 3, title }: { lines?: number; title?: string }) {
  const { t } = useTranslation();

  return (
    <Titled title={title}>
      <div className={`${ui.card} ${ui.stack3}`} aria-busy="true">
        <span className={styles.waitingNote}>{t('home.waiting')}</span>
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className={styles.waitingLine} style={{ width: `${70 - index * 15}%` }} />
        ))}
      </div>
    </Titled>
  );
}

/**
 * Nothing here yet: the sentence that says what is missing, in the dashed shape every screen says it in, and - where
 * the page has no other - the way to where it is set or added.
 */
export function NothingHere({ children, to, where }: { children: ReactNode; to?: string; where?: string }) {
  return (
    <p className={`${ui.cardDashed} ${ui.note}`}>
      {children}
      {to ? (
        <>
          {' '}
          <Link to={to} className={styles.wayOn}>
            {where}
          </Link>
        </>
      ) : null}
    </p>
  );
}
