import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './RouteError.module.css';

/**
 * What a screen that threw says for itself, in place of React Router's developer
 * page: that this screen could not be drawn, that nothing measured or written is
 * affected, and the two moves that lead anywhere. The error goes to the console.
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
