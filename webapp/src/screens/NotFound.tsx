import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './NotFound.module.css';

/**
 * An address the app has no screen for: said as that, not as a screen still to come. Signed out it stands in the
 * public frame, whose foot is the one way back (`home` false): "Start" beside "Zur App" were two ways to one place.
 */
export function NotFound({ home = true }: { home?: boolean }) {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <h1>{t('notFound.title')}</h1>
      <p className={ui.note}>{t('notFound.text')}</p>
      {home ? (
        <Link className={ui.button} to="/">
          {t('shell.gone.home')}
        </Link>
      ) : null}
    </section>
  );
}
