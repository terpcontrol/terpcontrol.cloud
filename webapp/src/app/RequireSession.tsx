import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { session, useSession } from '@/api/session';
import ui from '@/ui/ui.module.css';
// The page below stands exactly where the error page does - in place of the
// whole shell, with no bar above it - so it is laid out by the same stylesheet
// rather than by a copy of it.
import styles from './RouteError.module.css';

/**
 * Nothing is decided until the stored refresh token has been tried, or a reload
 * would bounce a signed-in person to the sign-in page for a frame.
 *
 * Trying it has three outcomes rather than two. The session is live, and the
 * screens are drawn. The server said the session is gone, and the sign-in page
 * is where that leads. Or nothing could be asked at all, because the API was
 * restarting or the phone was in a lift - and that is not a sign-out and is not
 * drawn as one: the tokens are still stored and still good, so the page says so
 * and offers to ask again, which after a deploy or a tunnel is all that is
 * needed. The door to the form stays open beside it for whoever would rather
 * type a password than wait.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { user, restored, unreachable } = useSession();
  const location = useLocation();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void session.restore();
  }, []);

  const askAgain = () => {
    setAsking(true);
    void session.restore().finally(() => setAsking(false));
  };

  // While an attempt is running the page stays as it is. The store publishes the
  // stored account before it knows whether the session is live, and rendering
  // the shell on that would send every screen behind it to an API that has just
  // refused to answer.
  if (asking || (restored && !user && unreachable)) return <CannotReach asking={asking} onAskAgain={askAgain} from={location.pathname} />;
  if (!restored) return null;
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return children;
}

/** What is said instead of the screens when the session could not be checked: that it is kept, and what to do. */
function CannotReach({ asking, onAskAgain, from }: { asking: boolean; onAskAgain: () => void; from: string }) {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t('shell.cannotReach.title')}</h1>
      <p className={ui.note} role="alert">
        {t('shell.cannotReach.why')}
      </p>
      <div className={styles.actions}>
        <button type="button" className={ui.button} onClick={onAskAgain} disabled={asking}>
          {asking ? t('shell.cannotReach.asking') : t('shell.cannotReach.again')}
        </button>
        <Link to="/sign-in" replace state={{ from }} className={ui.button}>
          {t('shell.cannotReach.signIn')}
        </Link>
      </div>
    </section>
  );
}
