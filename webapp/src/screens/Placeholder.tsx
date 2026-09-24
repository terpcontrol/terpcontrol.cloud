import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './Placeholder.module.css';

/**
 * A screen that has its route and its place in the shell but not yet its
 * content. It exists so navigation can be walked and tested before the screens
 * are drawn, and every one of these goes away as its slice lands.
 */
export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t(titleKey)}</h1>
      <p className={ui.note}>{t('shell.notYet')}</p>
      <Link className={ui.button} to="/">
        {t('notFound.home')}
      </Link>
    </section>
  );
}
