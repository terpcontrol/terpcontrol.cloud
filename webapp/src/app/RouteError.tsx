import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './RouteError.module.css';

/**
 * What a screen that threw says for itself.
 *
 * Without one of these React Router draws its own developer page - "Unexpected
 * Application Error!", a stack out of whatever library threw, and the line
 * "Hey developer, you can provide a way better UX than this" - in place of the
 * entire application, tabs and all. That is written for the person who can read
 * a stack, and a grower looking at their tent is not that person: a chart axis
 * that lands a hairsbreadth off a round number is not a reason to tell somebody
 * their app is gone.
 *
 * So it says the two things that are true and useful - this screen could not be
 * drawn, and nothing that was measured or written down is affected - and offers
 * the two moves that lead anywhere. The error itself still goes to the console,
 * where the developer this page used to be addressed to will find it.
 */
export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();

  useEffect(() => {
    console.error('A screen threw and was replaced by the error page:', error);
  }, [error]);

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t('shell.crashed.title')}</h1>
      <p className={ui.note} role="alert">
        {t('shell.crashed.why')}
      </p>
      <div className={styles.actions}>
        <button type="button" className={ui.button} onClick={() => window.location.reload()}>
          {t('shell.crashed.again')}
        </button>
        <Link to="/" className={ui.button}>
          {t('shell.crashed.home')}
        </Link>
      </div>
    </section>
  );
}
