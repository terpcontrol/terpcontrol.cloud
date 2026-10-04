import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './NotFound.module.css';

/** An address the app has no screen for: said as that, not as a screen still to come. */
export function NotFound() {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t('notFound.title')}</h1>
      <p className={ui.note}>{t('notFound.text')}</p>
      <Link className={ui.button} to="/">
        {t('notFound.home')}
      </Link>
    </section>
  );
}
